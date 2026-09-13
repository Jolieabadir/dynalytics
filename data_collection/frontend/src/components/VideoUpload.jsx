/**
 * VideoUpload component.
 *
 * Pose extraction runs client-side; the video itself is uploaded straight to R2
 * through a presigned URL. The server only ever receives the pose CSV plus the
 * metadata measured here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getMoves, registerVideo, uploadOriginalVideo } from '../api/client';
import { NotSignedInError } from '../api/auth';
import useStore from '../store/useStore';
import PoseExtractor, {
  ExtractionCancelledError,
  supportsFrameCallback,
} from '../services/PoseExtractor';

const STATE_LABEL = {
  loading: 'Loading pose model…',
  'detecting-fps': 'Measuring frame rate…',
  extracting: 'Extracting poses…',
  'paused-hidden': 'Paused — this tab is in the background',
};

function parseCsv(csvString) {
  const lines = csvString.split('\n');
  const headers = lines[0].split(',');
  return lines
    .slice(1)
    .map((line) => {
      const values = line.split(',');
      const row = {};
      headers.forEach((header, i) => {
        row[header.trim()] = values[i]?.trim();
      });
      return row;
    })
    .filter((row) => row.frame_number !== undefined && row.frame_number !== '');
}

function VideoUpload() {
  const [processing, setProcessing] = useState(false);
  const [phase, setPhase] = useState(null);
  const [status, setStatus] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [timeInfo, setTimeInfo] = useState(null);
  const [detectedFps, setDetectedFps] = useState(null);
  const [error, setError] = useState(null);
  const extractorRef = useRef(null);

  const browserSupported = supportsFrameCallback();

  const {
    setCurrentVideo,
    setMoves,
    setVideoBlobUrl,
    setCsvData,
    setCsvString,
  } = useStore();

  // Unmounting mid-extraction should not leave the loop and its object URL alive.
  useEffect(() => {
    return () => {
      if (extractorRef.current) extractorRef.current.cancel();
    };
  }, []);

  const handleCancel = useCallback(() => {
    if (extractorRef.current) extractorRef.current.cancel();
  }, []);

  const resetUi = () => {
    setProcessing(false);
    setPhase(null);
    setStatus('');
    setProgressPercent(0);
    setTimeInfo(null);
    setDetectedFps(null);
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // Let the same file be chosen again after a cancel or an error.
    e.target.value = '';

    const validTypes = ['video/quicktime', 'video/mp4', 'video/x-msvideo'];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(mov|mp4|avi)$/i)) {
      setError({ title: 'Unsupported file', message: 'Please upload a .mov, .mp4, or .avi file' });
      return;
    }

    const extractor = new PoseExtractor();
    extractorRef.current = extractor;

    const startedAt = performance.now();

    try {
      setProcessing(true);
      setError(null);
      setPhase('loading');
      setStatus(STATE_LABEL.loading);
      setProgressPercent(0);

      // Blob URL for later playback. Owned by the store, not the extractor.
      const blobUrl = URL.createObjectURL(file);
      setVideoBlobUrl(blobUrl);

      const { rows, fps, totalFrames, duration, width, height } = await extractor.extractFromFile(file, {
        onState: (state) => {
          setPhase(state);
          setStatus(STATE_LABEL[state] || '');
        },
        onProgress: ({ progress, currentTime, duration: total, fps: measuredFps }) => {
          setProgressPercent(Math.round(progress * 100));
          setTimeInfo({ currentTime, duration: total });
          if (measuredFps) setDetectedFps(measuredFps);
        },
      });

      const elapsedMs = performance.now() - startedAt;
      console.log(
        `[PoseExtractor] ${rows.length} frames in ${(elapsedMs / 1000).toFixed(1)}s ` +
          `(clip ${duration.toFixed(1)}s at ${fps}fps, ` +
          `${(elapsedMs / 1000 / duration).toFixed(2)}x realtime)`
      );

      setPhase(null);
      setStatus('Building CSV…');
      const csvString = extractor.framesToCSV(rows);
      setCsvString(csvString);
      setCsvData(parseCsv(csvString));
      extractor.close();

      setStatus('Saving…');
      const videoData = await registerVideo(
        {
          filename: file.name,
          fps,
          total_frames: totalFrames,
          duration_ms: duration * 1000,
          // Landmarks are stored as pixels at this resolution; without these,
          // they can never be normalized against hold boxes after the fact.
          width,
          height,
          csv_data: csvString,
        },
        {
          onRetry: (attempt, delayMs) => {
            setStatus(
              `Network problem — retrying (${attempt}/3) in ${Math.round(delayMs / 1000)}s…`
            );
          },
        }
      );

      // The pose data is safe at this point. The original video is a bonus, so
      // a failure here must not discard a successful extraction.
      setStatus('Uploading video…');
      try {
        await uploadOriginalVideo(videoData.id, file);
      } catch (uploadErr) {
        console.warn('[VideoUpload] Original video upload failed; pose data is saved.', uploadErr);
      }

      // Fall back to the measured values: a backend that predates the
      // dimensions migration echoes them back as null, and the store is where
      // hold-box normalization will read them from.
      setCurrentVideo({
        ...videoData,
        width: videoData.width ?? width,
        height: videoData.height ?? height,
      });
      setMoves(await getMoves(videoData.id));
    } catch (err) {
      if (err instanceof ExtractionCancelledError || err?.name === 'ExtractionCancelled') {
        resetUi();
        extractorRef.current = null;
        return;
      }

      console.error('Processing error:', err);

      if (err?.name === 'DecodeUnsupported') {
        setError({ title: "This video can't be read", message: err.message });
      } else if (err?.name === 'FrameCallbackUnsupported') {
        setError({ title: 'Unsupported browser', message: err.message });
      } else if (err instanceof NotSignedInError || err?.name === 'NotSignedIn') {
        setError({ title: 'Not signed in', message: err.message });
      } else {
        setError({
          title: 'Processing failed',
          message: err?.message || 'Processing failed. Please try again.',
        });
      }
      resetUi();
    } finally {
      extractorRef.current = null;
    }
  };

  if (!browserSupported) {
    return (
      <div className="video-upload">
        <div className="upload-container">
          <h2>Upload Climbing Video</h2>
          <div className="error-message">
            <p>
              <strong>This browser can&apos;t step through video frames.</strong>
            </p>
            <p>Please use Chrome, Edge, or Safari to upload a video.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="video-upload">
      <div className="upload-container">
        <h2>Upload Climbing Video</h2>
        <p>Upload a video to begin labeling climbing movements</p>

        {!processing ? (
          <div className="upload-area">
            <input
              type="file"
              id="video-upload"
              accept=".mov,.mp4,.avi"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <label htmlFor="video-upload" className="upload-button">
              Choose Video File
            </label>
            <p className="upload-hint">Supports .mov, .mp4, .avi</p>
            <p className="upload-hint" style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>
              Video is processed locally in your browser
            </p>
            <p className="upload-hint" style={{ marginTop: '4px', fontSize: '12px', color: '#888' }}>
              Best on a computer — phone browsers are slow for this step.
            </p>
          </div>
        ) : (
          <div className="upload-progress">
            <div className="spinner"></div>
            <p>{status}</p>

            <div className="progress-bar-container">
              <div className="progress-bar" style={{ width: `${progressPercent}%` }} />
            </div>

            <p className="progress-detail">
              {progressPercent}%
              {timeInfo &&
                ` — ${timeInfo.currentTime.toFixed(1)}s of ${timeInfo.duration.toFixed(1)}s`}
              {detectedFps && ` · ${detectedFps} fps`}
            </p>

            {phase === 'paused-hidden' ? (
              <p className="progress-detail" style={{ color: '#eab308' }}>
                Paused because this tab is in the background. Switch back to continue.
              </p>
            ) : (
              <p className="progress-detail" style={{ color: '#888' }}>
                Keep this tab open — extraction stops if you switch away.
              </p>
            )}

            <button type="button" className="cancel-button" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        )}

        {error && (
          <div className="error-message">
            <p>
              <strong>{error.title}</strong>
            </p>
            <p>{error.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default VideoUpload;
