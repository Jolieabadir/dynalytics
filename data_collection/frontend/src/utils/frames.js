/**
 * Frame ↔ time conversion.
 *
 * Every conversion in the app goes through here so that a single rounding rule
 * applies everywhere. Previously each component carried its own
 * `currentVideo?.fps || 30`, which silently produced 2x-wrong frame numbers on
 * a 60fps clip, and VideoPlayer floored where the extractor rounded, so the
 * player and the CSV could disagree by a frame.
 *
 * fps is measured during extraction and stored on the video object. There is
 * deliberately no default: a missing fps is a bug worth surfacing, not a
 * value worth guessing.
 */

/**
 * Read fps off a video record.
 * @param {{fps?: number}|null|undefined} video
 * @returns {number|null} null when unknown — callers should not convert.
 */
export function fpsOf(video) {
  const fps = video?.fps;
  return typeof fps === 'number' && Number.isFinite(fps) && fps > 0 ? fps : null;
}

/**
 * Frame index at a playback time.
 * Rounds, matching how the extractor derives frame_number from mediaTime.
 */
export function timeToFrame(timeSeconds, fps) {
  if (!fps) return 0;
  return Math.round(timeSeconds * fps);
}

/** Playback time at the start of a frame. */
export function frameToTime(frame, fps) {
  if (!fps) return 0;
  return frame / fps;
}

/** Playback time of a frame, in milliseconds. Matches the CSV's timestamp_ms. */
export function frameToMs(frame, fps) {
  if (!fps) return 0;
  return (frame / fps) * 1000;
}

/** Total frames in a clip. Rounds, so a final partial frame is not lost. */
export function totalFrames(durationSeconds, fps) {
  if (!fps) return 0;
  return Math.round(durationSeconds * fps);
}
