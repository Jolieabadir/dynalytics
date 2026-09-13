/**
 * Pure pose math: fps inference, frame indexing, angle geometry, CSV shaping.
 *
 * Deliberately free of any MediaPipe or DOM import. Everything here is a pure
 * function of its arguments, so the frame/timestamp math and the CSV contract
 * can be tested in Node without a browser or a WASM runtime — which matters,
 * because these are exactly the parts that were silently wrong before.
 */

// MediaPipe landmark indices we care about (maps to our landmark names)
export const LANDMARK_MAP = {
  0: 'nose',
  11: 'left_shoulder',
  12: 'right_shoulder',
  13: 'left_elbow',
  14: 'right_elbow',
  15: 'left_wrist',
  16: 'right_wrist',
  23: 'left_hip',
  24: 'right_hip',
  25: 'left_knee',
  26: 'right_knee',
  27: 'left_ankle',
  28: 'right_ankle',
  29: 'left_heel',
  30: 'right_heel',
};

// Angle definitions: [name, pointA, pointB (vertex), pointC]
export const ANGLE_DEFINITIONS = [
  ['left_elbow', 'left_shoulder', 'left_elbow', 'left_wrist'],
  ['right_elbow', 'right_shoulder', 'right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip', 'left_shoulder', 'left_elbow'],
  ['right_shoulder', 'right_hip', 'right_shoulder', 'right_elbow'],
  ['left_hip', 'left_shoulder', 'left_hip', 'left_knee'],
  ['right_hip', 'right_shoulder', 'right_hip', 'right_knee'],
  ['left_knee', 'left_hip', 'left_knee', 'left_ankle'],
  ['right_knee', 'right_hip', 'right_knee', 'right_ankle'],
  ['left_ankle', 'left_knee', 'left_ankle', 'left_heel'],
  ['right_ankle', 'right_knee', 'right_ankle', 'right_heel'],
];

/** fps values a phone or camera actually produces. Detection snaps to these. */
export const KNOWN_FPS = [24, 25, 30, 48, 50, 60, 120];

// ==================== GEOMETRY ====================

export function angleBetween(a, b, c) {
  // Calculate angle at point b given three landmarks
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.sqrt(ab.x ** 2 + ab.y ** 2);
  const magCB = Math.sqrt(cb.x ** 2 + cb.y ** 2);
  if (magAB === 0 || magCB === 0) return null;
  const cosAngle = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
  return Math.acos(cosAngle) * (180 / Math.PI);
}

export function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  };
}

function calculateUpperBack(landmarks) {
  const ls = landmarks['left_shoulder'];
  const rs = landmarks['right_shoulder'];
  if (!ls || !rs) return null;
  const mid = midpoint(ls, rs);
  return angleBetween(ls, mid, rs);
}

function calculateLowerBack(landmarks) {
  const ls = landmarks['left_shoulder'];
  const rs = landmarks['right_shoulder'];
  const lh = landmarks['left_hip'];
  const rh = landmarks['right_hip'];
  const lk = landmarks['left_knee'];
  const rk = landmarks['right_knee'];
  if (!ls || !rs || !lh || !rh || !lk || !rk) return null;
  const shoulderMid = midpoint(ls, rs);
  const hipMid = midpoint(lh, rh);
  const kneeMid = midpoint(lk, rk);
  return angleBetween(shoulderMid, hipMid, kneeMid);
}

export function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ==================== fps DETECTION ====================

/**
 * Infer fps from the intervals between presented frames.
 *
 * Median rather than mean: a single long interval (a stalled decode, a
 * backgrounded tab) would drag a mean badly, but moves a median barely at all.
 * The result snaps to the nearest plausible capture rate, since a measured
 * 59.94 and a measured 60.02 are both a 60fps camera.
 *
 * @param {number[]} mediaTimes presentation times in seconds, in order
 * @returns {number|null} null when there is too little to measure
 */
export function detectFps(mediaTimes) {
  if (!mediaTimes || mediaTimes.length < 3) return null;

  const deltas = [];
  for (let i = 1; i < mediaTimes.length; i++) {
    const d = mediaTimes[i] - mediaTimes[i - 1];
    if (d > 0) deltas.push(d);
  }
  if (deltas.length === 0) return null;

  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  const median =
    deltas.length % 2 === 0 ? (deltas[mid - 1] + deltas[mid]) / 2 : deltas[mid];
  if (!(median > 0)) return null;

  const measured = 1 / median;

  let best = KNOWN_FPS[0];
  let bestDiff = Infinity;
  for (const candidate of KNOWN_FPS) {
    const diff = Math.abs(candidate - measured);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return best;
}

/** frame_index for a presentation time, per the detected rate. */
export function frameIndexFor(mediaTimeSeconds, fps) {
  return Math.round(mediaTimeSeconds * fps);
}

/** Total frames in a clip of this duration. Rounds, so the last partial frame survives. */
export function totalFramesFor(durationSeconds, fps) {
  return Math.round(durationSeconds * fps);
}

// ==================== FRAME RESULT ====================

/**
 * Turn one frame's raw MediaPipe landmarks into the row payload.
 *
 * `videoWidth`/`videoHeight` must be the ORIGINAL video dimensions, not the
 * downscaled inference canvas's. MediaPipe returns normalized coordinates and
 * the CSV stores pixels at source resolution, so denormalizing against the
 * smaller canvas would silently shrink every coordinate.
 *
 * @param {Array<{x:number,y:number,z:number,visibility?:number}>} rawLandmarks
 * @param {{prevCom: object|null, prevTimestampMs: number|null}} prev
 */
export function computeResult(rawLandmarks, videoWidth, videoHeight, timestampMs, prev = {}) {
  if (!rawLandmarks) return null;

  const landmarks = {};
  for (const [index, name] of Object.entries(LANDMARK_MAP)) {
    const lm = rawLandmarks[parseInt(index)];
    if (lm) {
      landmarks[name] = {
        x: lm.x * videoWidth,
        y: lm.y * videoHeight,
        z: lm.z,
        visibility: lm.visibility || 0,
      };
    }
  }

  // Calculate 10 standard angles
  const angles = {};
  for (const [angleName, ptA, ptB, ptC] of ANGLE_DEFINITIONS) {
    if (landmarks[ptA] && landmarks[ptB] && landmarks[ptC]) {
      angles[angleName] = angleBetween(landmarks[ptA], landmarks[ptB], landmarks[ptC]);
    } else {
      angles[angleName] = null;
    }
  }
  // 2 back angles
  angles['upper_back'] = calculateUpperBack(landmarks);
  angles['lower_back'] = calculateLowerBack(landmarks);

  // Center of mass speed
  let comSpeed = 0;
  let com = null;
  if (landmarks['left_hip'] && landmarks['right_hip']) {
    com = midpoint(landmarks['left_hip'], landmarks['right_hip']);
    const { prevCom, prevTimestampMs } = prev;
    if (prevCom && prevTimestampMs !== null && prevTimestampMs !== undefined) {
      const dt = (timestampMs - prevTimestampMs) / 1000; // seconds
      if (dt > 0) {
        comSpeed = distance(com, prevCom) / dt;
      }
    }
    landmarks._com = com;
  }

  return { landmarks, angles, comSpeed, com };
}

// ==================== ROW / CSV SHAPING ====================

/**
 * Turn captured samples into contiguous CSV rows.
 *
 * Two invariants matter downstream: SkeletonOverlay indexes the parsed CSV by
 * position, so row N must be frame N; and frame numbers must line up with what
 * the player computes from currentTime. So frame_number comes from the
 * presentation time, duplicates are dropped, and any hole is filled with an
 * empty (pose-less) row rather than left as a gap.
 *
 * @param {Array<{mediaTime: number, result: object|null}>} samples
 * @param {number} fps
 */
export function buildRows(samples, fps) {
  const ordered = [...samples].sort((a, b) => a.mediaTime - b.mediaTime);

  const byIndex = new Map();
  for (const sample of ordered) {
    const frameNum = frameIndexFor(sample.mediaTime, fps);
    // First writer wins: the earliest presentation time for this index.
    if (!byIndex.has(frameNum)) {
      byIndex.set(frameNum, sample.result);
    }
  }

  if (byIndex.size === 0) return [];

  let maxIndex = 0;
  for (const key of byIndex.keys()) {
    if (key > maxIndex) maxIndex = key;
  }

  const rows = [];
  for (let frameNum = 0; frameNum <= maxIndex; frameNum++) {
    rows.push({
      frameNum,
      // Derived from the index, so timestamp_ms === frame_number / fps exactly.
      timestampMs: (frameNum / fps) * 1000,
      result: byIndex.has(frameNum) ? byIndex.get(frameNum) : null,
    });
  }
  return rows;
}

/** The 75-column header. Order is a fixed contract. */
export function csvHeaders() {
  const landmarkNames = Object.values(LANDMARK_MAP);
  const headers = [
    'frame_number', 'timestamp_ms', 'speed_center_of_mass',
    ...ANGLE_DEFINITIONS.map(([name]) => `angle_${name}`),
    'angle_upper_back', 'angle_lower_back',
  ];
  for (const name of landmarkNames) {
    headers.push(`landmark_${name}_x`, `landmark_${name}_y`, `landmark_${name}_z`, `landmark_${name}_visibility`);
  }
  return headers;
}

/** Build the CSV string. Column order and value formatting are a fixed contract. */
export function framesToCSV(frames) {
  const landmarkNames = Object.values(LANDMARK_MAP);
  const rows = [csvHeaders().join(',')];

  for (const frame of frames) {
    const row = [
      frame.frameNum,
      frame.timestampMs,
      frame.result ? frame.result.comSpeed : 0,
    ];

    // Angles
    for (const [angleName] of ANGLE_DEFINITIONS) {
      row.push(frame.result?.angles?.[angleName] ?? '');
    }
    row.push(frame.result?.angles?.['upper_back'] ?? '');
    row.push(frame.result?.angles?.['lower_back'] ?? '');

    // Landmarks
    for (const name of landmarkNames) {
      const lm = frame.result?.landmarks?.[name];
      if (lm) {
        row.push(lm.x, lm.y, lm.z, lm.visibility);
      } else {
        row.push('', '', '', '');
      }
    }

    rows.push(row.join(','));
  }

  return rows.join('\n');
}
