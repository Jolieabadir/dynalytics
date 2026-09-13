/**
 * Deterministic frame fixtures behind the golden CSV.
 *
 * Shared by scripts/make_golden.mjs (which writes the golden file) and
 * scripts/test_pose_math.mjs (which asserts against it), so the two cannot
 * drift apart. Nothing here is random at run time: the PRNG is seeded, so the
 * same frames — and therefore the same bytes — come out on every machine.
 *
 * The frames deliberately cover the awkward cases, not just the happy path:
 * a pose-less frame, individual landmarks missing, an angle that comes back
 * null, and the first frame's zero centre-of-mass speed.
 */
import { computeResult, LANDMARK_MAP } from '../src/services/poseMath.js';

const LANDMARK_COUNT = Object.keys(LANDMARK_MAP).length;

/** Seeded LCG — same sequence everywhere, unlike Math.random. */
function makeRng(seed = 20260913) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296;
  };
}

const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;
const FPS = 60;
const FRAME_COUNT = 40;

/**
 * Build the canonical fixture frames.
 * @returns {Array<{frameNum: number, timestampMs: number, result: object|null}>}
 */
export function goldenFrames() {
  const rng = makeRng();
  const frames = [];

  let prevCom = null;
  let prevTimestampMs = null;

  for (let frameNum = 0; frameNum < FRAME_COUNT; frameNum++) {
    const timestampMs = (frameNum / FPS) * 1000;

    // Every 7th frame: no pose detected at all.
    if (frameNum % 7 === 3) {
      frames.push({ frameNum, timestampMs, result: null });
      continue;
    }

    const raw = Array.from({ length: LANDMARK_COUNT }, () => ({
      x: rng(),
      y: rng(),
      z: rng() - 0.5,
      visibility: rng(),
    }));

    // Every 11th frame: drop a wrist and an ankle, so some landmark columns are
    // empty and the angles depending on them come back null.
    if (frameNum % 11 === 5) {
      raw[15] = undefined; // left_wrist
      raw[27] = undefined; // left_ankle
    }

    // Every 13th frame: drop both hips, which zeroes centre-of-mass speed and
    // nulls the lower-back angle.
    if (frameNum % 13 === 8) {
      raw[23] = undefined;
      raw[24] = undefined;
    }

    const result = computeResult(raw, VIDEO_WIDTH, VIDEO_HEIGHT, timestampMs, {
      prevCom,
      prevTimestampMs,
    });

    if (result?.com) {
      prevCom = result.com;
      prevTimestampMs = timestampMs;
    }

    frames.push({ frameNum, timestampMs, result });
  }

  return frames;
}

export const GOLDEN_META = {
  videoWidth: VIDEO_WIDTH,
  videoHeight: VIDEO_HEIGHT,
  fps: FPS,
  frameCount: FRAME_COUNT,
  landmarkCount: LANDMARK_COUNT,
};
