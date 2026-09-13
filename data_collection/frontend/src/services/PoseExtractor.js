/**
 * Client-side pose extraction.
 *
 * Strategy: play the video through once and capture each frame as the decoder
 * presents it, rather than seeking to each frame in turn. A seek-per-frame walk
 * makes the decoder re-decode from the preceding keyframe every time, which is
 * what made a 2-minute clip take many minutes. Playing through decodes each
 * frame exactly once, so the floor is roughly the clip's own length.
 *
 * The loop pauses on every frame callback and only resumes after inference has
 * finished, so a slow device falls behind wall-clock time but never drops a
 * frame.
 *
 * Requires requestVideoFrameCallback (Chrome, Edge, Safari). There is
 * deliberately no seek-based fallback — maintaining the slow path was the
 * problem being removed.
 */
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import {
  LANDMARK_MAP,
  ANGLE_DEFINITIONS,
  KNOWN_FPS,
  detectFps,
  frameIndexFor,
  totalFramesFor,
  computeResult,
  buildRows,
  framesToCSV,
  csvHeaders,
} from './poseMath';

// Pinned to the version in package-lock.json. The WASM glue and the JS wrapper
// must agree, and `@latest` also defeats CDN caching between uploads.
const TASKS_VISION_VERSION = '0.10.32';
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/** Longest edge of the inference canvas. Input downscale cap. */
const MAX_INFERENCE_EDGE = 512;

/** How much of the clip to sample before deciding on fps. */
const FPS_SAMPLE_SECONDS = 2;

/** How long to wait for the first frame callback before calling it a decode failure. */
const FIRST_FRAME_TIMEOUT_MS = 5000;

/**
 * Last-resort fps when a clip is too short to measure (fewer than 3 presented
 * frames). Not an assumption about the input the way the old hardcoded 30 was:
 * detection has already failed by the time this is reached.
 */
const FALLBACK_FPS = 30;

const DECODE_UNSUPPORTED_MESSAGE =
  "This video format can't be decoded in this browser. On iPhone, set " +
  'Camera → Formats → Most Compatible, or convert to H.264 (MP4).';

/** Thrown when the browser cannot decode the file at all (e.g. HEVC on Chrome). */
export class DecodeUnsupportedError extends Error {
  constructor(message = DECODE_UNSUPPORTED_MESSAGE) {
    super(message);
    this.name = 'DecodeUnsupported';
  }
}

/** Thrown when the browser has no requestVideoFrameCallback. */
export class FrameCallbackUnsupportedError extends Error {
  constructor() {
    super(
      'This browser cannot step through video frames. Please use Chrome, Edge, or Safari.'
    );
    this.name = 'FrameCallbackUnsupported';
  }
}

/** Thrown by cancel(). Callers treat this as "no error", not a failure. */
export class ExtractionCancelledError extends Error {
  constructor() {
    super('Extraction cancelled');
    this.name = 'ExtractionCancelled';
  }
}

export function supportsFrameCallback() {
  return (
    typeof HTMLVideoElement !== 'undefined' &&
    typeof HTMLVideoElement.prototype.requestVideoFrameCallback === 'function'
  );
}

// ==================== MODEL SINGLETON ====================

let landmarkerPromise = null;
let landmarkerDelegate = null;

async function createLandmarker(delegate) {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

/**
 * Load the PoseLandmarker once per page load.
 *
 * Cached as a promise rather than a value so that two uploads started in quick
 * succession share one download instead of racing. GPU first, CPU on failure.
 */
export function getPoseLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      try {
        const lm = await createLandmarker('GPU');
        landmarkerDelegate = 'GPU';
        return lm;
      } catch (gpuError) {
        console.warn('[PoseExtractor] GPU delegate unavailable, falling back to CPU:', gpuError);
        const lm = await createLandmarker('CPU');
        landmarkerDelegate = 'CPU';
        return lm;
      }
    })().catch((err) => {
      // Don't cache a failure; the next attempt should be able to retry.
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

export function getDelegate() {
  return landmarkerDelegate;
}

// ==================== EXTRACTOR ====================

export class PoseExtractor {
  constructor() {
    this.poseLandmarker = null;
    this.previousCom = null;
    this.previousTimestampMs = null;
    this.cancelled = false;
    this._cleanup = null;
    this._onCancel = null;
    // detectForVideo requires strictly increasing timestamps across a session.
    this._lastDetectTimestamp = -1;
  }

  async initialize() {
    this.poseLandmarker = await getPoseLandmarker();
    return this.poseLandmarker;
  }

  /**
   * Run inference on one already-drawn canvas.
   *
   * `videoWidth`/`videoHeight` are the ORIGINAL video dimensions, not the
   * canvas's. MediaPipe returns normalized coordinates and the CSV contract
   * stores pixels at source resolution, so denormalizing against the downscaled
   * canvas would silently shrink every coordinate.
   */
  processCanvas(canvas, timestampMs, videoWidth, videoHeight) {
    if (!this.poseLandmarker) return null;

    // Strictly increasing, or MediaPipe rejects the call.
    const ts = Math.max(timestampMs, this._lastDetectTimestamp + 0.001);
    this._lastDetectTimestamp = ts;

    const detection = this.poseLandmarker.detectForVideo(canvas, ts);

    if (!detection.landmarks || detection.landmarks.length === 0) {
      return null;
    }

    const result = computeResult(detection.landmarks[0], videoWidth, videoHeight, timestampMs, {
      prevCom: this.previousCom,
      prevTimestampMs: this.previousTimestampMs,
    });

    if (result?.com) {
      this.previousCom = result.com;
      this.previousTimestampMs = timestampMs;
    }

    return result;
  }

  /** Abort an in-flight extraction. Safe to call more than once. */
  cancel() {
    this.cancelled = true;
    if (this._onCancel) this._onCancel();
    if (this._cleanup) this._cleanup();
  }

  /**
   * Extract every frame of a video file.
   *
   * @param {File|Blob} file
   * @param {object} callbacks
   * @param {(p: {progress: number, currentTime: number, duration: number, framesCaptured: number, fps: number|null}) => void} [callbacks.onProgress]
   * @param {(state: 'loading'|'detecting-fps'|'extracting'|'paused-hidden') => void} [callbacks.onState]
   * @returns {Promise<{rows: Array, fps: number, totalFrames: number, duration: number, width: number, height: number}>}
   */
  async extractFromFile(file, { onProgress, onState } = {}) {
    if (!supportsFrameCallback()) {
      throw new FrameCallbackUnsupportedError();
    }

    this.previousCom = null;
    this.previousTimestampMs = null;
    this._lastDetectTimestamp = -1;
    this.cancelled = false;

    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = objectUrl;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'auto';
    // Kept out of the layout but still decoded. `display:none` lets some
    // browsers skip frame presentation entirely.
    video.style.position = 'fixed';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.left = '-10px';
    video.style.top = '-10px';
    document.body.appendChild(video);

    let frameHandle = null;
    let released = false;
    let onVisibilityChange = () => {};

    const release = () => {
      if (released) return;
      released = true;
      if (frameHandle !== null && video.cancelVideoFrameCallback) {
        try {
          video.cancelVideoFrameCallback(frameHandle);
        } catch {
          /* already fired */
        }
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      try {
        video.pause();
      } catch {
        /* not playing */
      }
      video.removeAttribute('src');
      video.load();
      video.remove();
      URL.revokeObjectURL(objectUrl);
    };
    this._cleanup = release;

    try {
      await this._loadMetadata(video);

      if (!video.videoWidth || !video.videoHeight) {
        throw new DecodeUnsupportedError();
      }

      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new DecodeUnsupportedError();
      }

      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;

      // Downscaled inference surface, sized once.
      const scale = Math.min(1, MAX_INFERENCE_EDGE / Math.max(videoWidth, videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(videoWidth * scale));
      canvas.height = Math.max(1, Math.round(videoHeight * scale));
      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

      if (onState) onState('loading');
      await this.initialize();

      if (this.cancelled) throw new ExtractionCancelledError();

      if (onState) onState('detecting-fps');

      // ---- capture loop ----

      const samples = []; // { mediaTime, result }
      const fpsSampleTimes = [];
      let fps = null;
      let sawFirstFrame = false;

      let resolveDone;
      let rejectDone;
      const done = new Promise((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
      });

      this._onCancel = () => rejectDone(new ExtractionCancelledError());

      let pausedForHidden = false;
      onVisibilityChange = () => {
        if (document.hidden) {
          pausedForHidden = true;
          if (onState) onState('paused-hidden');
          try {
            video.pause();
          } catch {
            /* ignore */
          }
        } else if (pausedForHidden) {
          pausedForHidden = false;
          if (onState) onState(fps ? 'extracting' : 'detecting-fps');
          video.play().catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', onVisibilityChange);

      video.addEventListener('error', () => {
        rejectDone(new DecodeUnsupportedError());
      });

      video.addEventListener('ended', () => {
        resolveDone();
      });

      const onFrame = async (_now, metadata) => {
        if (this.cancelled) return;

        try {
          video.pause();

          const mediaTime = metadata.mediaTime;
          sawFirstFrame = true;

          // Decide fps once enough of the head of the clip has been seen.
          if (fps === null) {
            fpsSampleTimes.push(mediaTime);
            if (
              mediaTime >= FPS_SAMPLE_SECONDS ||
              mediaTime >= duration - 1e-6 ||
              fpsSampleTimes.length > 300
            ) {
              fps = detectFps(fpsSampleTimes) ?? FALLBACK_FPS;
              if (onState) onState('extracting');
            }
          }

          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const result = this.processCanvas(canvas, mediaTime * 1000, videoWidth, videoHeight);
          samples.push({ mediaTime, result });

          if (onProgress) {
            onProgress({
              progress: duration > 0 ? Math.min(1, mediaTime / duration) : 0,
              currentTime: mediaTime,
              duration,
              framesCaptured: samples.length,
              fps,
            });
          }

          if (this.cancelled) return;

          // Past the last frame the 'ended' event may never arrive if the
          // decoder stops presenting; treat reaching the end as done.
          if (video.ended) {
            resolveDone();
            return;
          }

          frameHandle = video.requestVideoFrameCallback(onFrame);
          if (!pausedForHidden) {
            await video.play().catch(() => {});
          }
        } catch (err) {
          rejectDone(err);
        }
      };

      frameHandle = video.requestVideoFrameCallback(onFrame);
      await video.play().catch(() => {
        throw new DecodeUnsupportedError();
      });

      // A file the browser accepts but cannot actually decode never presents a
      // frame. Nothing else detects that case.
      const firstFrameTimer = setTimeout(() => {
        if (!sawFirstFrame) rejectDone(new DecodeUnsupportedError());
      }, FIRST_FRAME_TIMEOUT_MS);

      try {
        await done;
      } finally {
        clearTimeout(firstFrameTimer);
      }

      if (this.cancelled) throw new ExtractionCancelledError();

      if (samples.length === 0) {
        throw new DecodeUnsupportedError();
      }

      if (fps === null) {
        fps = detectFps(fpsSampleTimes) ?? FALLBACK_FPS;
      }

      const rows = buildRows(samples, fps);
      const totalFrames = totalFramesFor(duration, fps);

      return { rows, fps, totalFrames, duration, width: videoWidth, height: videoHeight };
    } finally {
      this._onCancel = null;
      release();
      this._cleanup = null;
    }
  }

  _loadMetadata(video) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new DecodeUnsupportedError());
      };
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
    });
  }

  framesToCSV(rows) {
    return framesToCSV(rows);
  }

  close() {
    // The landmarker is a shared singleton and is deliberately NOT closed here;
    // closing it would force the next upload to re-download the model.
    this.previousCom = null;
    this.previousTimestampMs = null;
  }
}

export {
  LANDMARK_MAP,
  ANGLE_DEFINITIONS,
  KNOWN_FPS,
  MAX_INFERENCE_EDGE,
  FALLBACK_FPS,
  DECODE_UNSUPPORTED_MESSAGE,
  detectFps,
  frameIndexFor,
  totalFramesFor,
  buildRows,
  framesToCSV,
  csvHeaders,
};
export default PoseExtractor;
