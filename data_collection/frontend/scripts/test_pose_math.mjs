/**
 * Tests for the pose frame/timestamp math and the CSV contract.
 *
 * Run: node --test scripts/test_pose_math.mjs
 *
 * These cover the parts that were silently wrong before — fps inference, the
 * frame_number/timestamp_ms relationship, and row shaping — using real frame
 * presentation times recorded from the clips scripts/make_test_video.sh
 * generates, read back with ffprobe. The fixtures stand in for
 * requestVideoFrameCallback's mediaTime, which is the same quantity.
 *
 * What this canNOT cover: MediaPipe inference itself, the play/pause capture
 * loop, decode failure, and the visibilitychange handling. Those need a real
 * browser with a GPU and are listed as manual checks in REPORT.md.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  detectFps,
  frameIndexFor,
  totalFramesFor,
  buildRows,
  framesToCSV,
  csvHeaders,
  computeResult,
  LANDMARK_MAP,
  ANGLE_DEFINITIONS,
} from '../src/services/poseMath.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const loadFixture = (name) =>
  JSON.parse(readFileSync(join(HERE, 'fixtures', name), 'utf8'));

const fixture30 = loadFixture('frame_times_30fps.json');
const fixture60 = loadFixture('frame_times_60fps.json');

/** Evenly spaced presentation times, as an ideal camera would produce. */
const evenTimes = (fps, seconds) =>
  Array.from({ length: Math.round(fps * seconds) }, (_, i) => i / fps);

// ==================== fps DETECTION ====================

test('detectFps recovers each supported rate from ideal timings', () => {
  for (const fps of [24, 25, 30, 48, 50, 60, 120]) {
    assert.equal(detectFps(evenTimes(fps, 2)), fps, `failed at ${fps}fps`);
  }
});

test('detectFps snaps NTSC rates to their nominal neighbour', () => {
  // 29.97 and 59.94 are what a US phone actually writes; both must land on the
  // round number, or frame_index drifts by a frame every ~33 seconds.
  assert.equal(detectFps(evenTimes(30000 / 1001, 2)), 30);
  assert.equal(detectFps(evenTimes(60000 / 1001, 2)), 60);
  assert.equal(detectFps(evenTimes(24000 / 1001, 2)), 24);
});

test('detectFps survives a stalled interval', () => {
  // One long gap (a backgrounded tab, a decode hiccup) must not move the
  // answer. This is the reason for a median rather than a mean.
  const times = evenTimes(60, 2);
  const stalled = times.map((t, i) => (i >= 60 ? t + 0.8 : t));
  assert.equal(detectFps(stalled), 60);

  const mean = 1 / ((stalled.at(-1) - stalled[0]) / (stalled.length - 1));
  assert.ok(mean < 45, `a mean would have given ~${mean.toFixed(1)}fps`);
});

test('detectFps tolerates jitter within a rate', () => {
  let t = 0;
  const times = [];
  for (let i = 0; i < 120; i++) {
    times.push(t);
    t += 1 / 60 + (Math.sin(i) * 0.0008); // sub-millisecond wobble
  }
  assert.equal(detectFps(times), 60);
});

test('detectFps returns null when there is too little to measure', () => {
  assert.equal(detectFps([]), null);
  assert.equal(detectFps([0]), null);
  assert.equal(detectFps([0, 1 / 30]), null);
  assert.equal(detectFps(null), null);
});

test('detectFps identifies the real recorded clips', () => {
  assert.equal(detectFps(fixture30.mediaTimes.slice(0, 60)), 30);
  assert.equal(detectFps(fixture60.mediaTimes.slice(0, 120)), 60);
  // And the 60fps clip must not be mistaken for 30, which was the original bug.
  assert.notEqual(detectFps(fixture60.mediaTimes.slice(0, 120)), 30);
});

// ==================== FRAME INDEX MATH ====================

test('frameIndexFor rounds to the nearest frame', () => {
  assert.equal(frameIndexFor(0, 30), 0);
  assert.equal(frameIndexFor(1 / 30, 30), 1);
  assert.equal(frameIndexFor(0.99 / 30, 30), 1); // just early, still frame 1
  assert.equal(frameIndexFor(1.01 / 30, 30), 1); // just late, still frame 1
  assert.equal(frameIndexFor(10, 60), 600);
});

test('totalFramesFor rounds rather than truncating', () => {
  assert.equal(totalFramesFor(10, 30), 300);
  assert.equal(totalFramesFor(10, 60), 600);
  // The old Math.floor dropped the final partial frame.
  assert.equal(totalFramesFor(9.99, 30), 300);
  assert.equal(totalFramesFor(120.5, 60), 7230);
});

test('every recorded presentation time maps to its own frame index', () => {
  for (const fx of [fixture30, fixture60]) {
    const indices = fx.mediaTimes.map((t) => frameIndexFor(t, fx.nominalFps));
    const unique = new Set(indices);
    assert.equal(
      unique.size,
      indices.length,
      `${fx.source}: two frames collided on one index`
    );
    for (let i = 0; i < indices.length; i++) {
      assert.equal(indices[i], i, `${fx.source}: frame ${i} indexed as ${indices[i]}`);
    }
  }
});

// ==================== ROW SHAPING ====================

const fakeResult = (n) => ({
  landmarks: Object.fromEntries(
    Object.values(LANDMARK_MAP).map((name) => [
      name,
      { x: n, y: n * 2, z: 0.5, visibility: 0.9 },
    ])
  ),
  angles: Object.fromEntries([
    ...ANGLE_DEFINITIONS.map(([name]) => [name, 90]),
    ['upper_back', 170],
    ['lower_back', 160],
  ]),
  comSpeed: 1.5,
});

const samplesFrom = (times) =>
  times.map((mediaTime, i) => ({ mediaTime, result: fakeResult(i) }));

test('rows are contiguous from 0 with no gaps, for both clips', () => {
  for (const fx of [fixture30, fixture60]) {
    const rows = buildRows(samplesFrom(fx.mediaTimes), fx.nominalFps);

    assert.equal(rows[0].frameNum, 0, `${fx.source}: does not start at 0`);
    for (let i = 0; i < rows.length; i++) {
      assert.equal(rows[i].frameNum, i, `${fx.source}: gap or repeat at row ${i}`);
    }
  }
});

test('row count matches duration x fps for both clips', () => {
  for (const fx of [fixture30, fixture60]) {
    const rows = buildRows(samplesFrom(fx.mediaTimes), fx.nominalFps);
    const expected = totalFramesFor(fx.duration, fx.nominalFps);
    assert.ok(
      Math.abs(rows.length - expected) <= 1,
      `${fx.source}: got ${rows.length} rows, expected ~${expected}`
    );
  }
});

test('timestamp equals frame_index / fps to within 1ms', () => {
  for (const fx of [fixture30, fixture60]) {
    const rows = buildRows(samplesFrom(fx.mediaTimes), fx.nominalFps);
    for (const row of rows) {
      const expectedMs = (row.frameNum / fx.nominalFps) * 1000;
      assert.ok(
        Math.abs(row.timestampMs - expectedMs) < 1,
        `${fx.source}: frame ${row.frameNum} timestamp ${row.timestampMs} vs ${expectedMs}`
      );
    }
  }
});

test('timestamps increase strictly', () => {
  const rows = buildRows(samplesFrom(fixture60.mediaTimes), 60);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].timestampMs > rows[i - 1].timestampMs, `not increasing at ${i}`);
  }
});

test('duplicate presentation times collapse to one row', () => {
  // Two callbacks for the same frame must not produce two rows, or every row
  // after it is off by one against the player.
  const times = [0, 1 / 30, 1 / 30 + 0.0001, 2 / 30, 3 / 30];
  const rows = buildRows(samplesFrom(times), 30);
  assert.equal(rows.length, 4);
  rows.forEach((r, i) => assert.equal(r.frameNum, i));
});

test('a missing frame is filled rather than left as a gap', () => {
  // SkeletonOverlay indexes the parsed CSV positionally, so a hole would
  // misalign every later frame instead of just losing one.
  const times = [0, 1 / 30, 3 / 30, 4 / 30]; // frame 2 never arrived
  const rows = buildRows(samplesFrom(times), 30);

  assert.equal(rows.length, 5);
  rows.forEach((r, i) => assert.equal(r.frameNum, i));
  assert.equal(rows[2].result, null, 'the hole should be an empty row');
  assert.notEqual(rows[3].result, null);
});

test('out-of-order samples are sorted before indexing', () => {
  const rows = buildRows(samplesFrom([2 / 30, 0, 1 / 30]), 30);
  assert.deepEqual(rows.map((r) => r.frameNum), [0, 1, 2]);
});

test('buildRows on no samples yields no rows', () => {
  assert.deepEqual(buildRows([], 30), []);
});

// ==================== CSV CONTRACT ====================

const EXPECTED_HEADER =
  'frame_number,timestamp_ms,speed_center_of_mass,angle_left_elbow,angle_right_elbow,' +
  'angle_left_shoulder,angle_right_shoulder,angle_left_hip,angle_right_hip,angle_left_knee,' +
  'angle_right_knee,angle_left_ankle,angle_right_ankle,angle_upper_back,angle_lower_back,' +
  'landmark_nose_x,landmark_nose_y,landmark_nose_z,landmark_nose_visibility,' +
  'landmark_left_shoulder_x,landmark_left_shoulder_y,landmark_left_shoulder_z,landmark_left_shoulder_visibility,' +
  'landmark_right_shoulder_x,landmark_right_shoulder_y,landmark_right_shoulder_z,landmark_right_shoulder_visibility,' +
  'landmark_left_elbow_x,landmark_left_elbow_y,landmark_left_elbow_z,landmark_left_elbow_visibility,' +
  'landmark_right_elbow_x,landmark_right_elbow_y,landmark_right_elbow_z,landmark_right_elbow_visibility,' +
  'landmark_left_wrist_x,landmark_left_wrist_y,landmark_left_wrist_z,landmark_left_wrist_visibility,' +
  'landmark_right_wrist_x,landmark_right_wrist_y,landmark_right_wrist_z,landmark_right_wrist_visibility,' +
  'landmark_left_hip_x,landmark_left_hip_y,landmark_left_hip_z,landmark_left_hip_visibility,' +
  'landmark_right_hip_x,landmark_right_hip_y,landmark_right_hip_z,landmark_right_hip_visibility,' +
  'landmark_left_knee_x,landmark_left_knee_y,landmark_left_knee_z,landmark_left_knee_visibility,' +
  'landmark_right_knee_x,landmark_right_knee_y,landmark_right_knee_z,landmark_right_knee_visibility,' +
  'landmark_left_ankle_x,landmark_left_ankle_y,landmark_left_ankle_z,landmark_left_ankle_visibility,' +
  'landmark_right_ankle_x,landmark_right_ankle_y,landmark_right_ankle_z,landmark_right_ankle_visibility,' +
  'landmark_left_heel_x,landmark_left_heel_y,landmark_left_heel_z,landmark_left_heel_visibility,' +
  'landmark_right_heel_x,landmark_right_heel_y,landmark_right_heel_z,landmark_right_heel_visibility';

test('the header is byte-identical to the shipped contract', () => {
  assert.equal(csvHeaders().join(','), EXPECTED_HEADER);
  assert.equal(csvHeaders().length, 75);
});

test('every row carries exactly 75 fields', () => {
  const rows = buildRows(samplesFrom(fixture30.mediaTimes.slice(0, 20)), 30);
  const lines = framesToCSV(rows).split('\n');
  for (const [i, line] of lines.entries()) {
    assert.equal(line.split(',').length, 75, `line ${i} has the wrong field count`);
  }
});

test('a pose-less frame is encoded as zero speed and empty columns', () => {
  const rows = [{ frameNum: 7, timestampMs: 233.33, result: null }];
  const fields = framesToCSV(rows).split('\n')[1].split(',');

  assert.equal(fields[0], '7');
  assert.equal(fields[1], '233.33');
  assert.equal(fields[2], '0', 'speed should be 0, not empty');
  for (let i = 3; i < 75; i++) {
    assert.equal(fields[i], '', `column ${i} should be empty`);
  }
});

test('the CSV has no trailing newline and one header line', () => {
  const csv = framesToCSV(buildRows(samplesFrom([0, 1 / 30, 2 / 30]), 30));
  assert.ok(!csv.endsWith('\n'));
  assert.equal(csv.split('\n').length, 4); // header + 3 rows
});

test('no field can contain a comma, so unquoted CSV stays parseable', () => {
  const rows = buildRows(samplesFrom(fixture30.mediaTimes.slice(0, 30)), 30);
  for (const line of framesToCSV(rows).split('\n')) {
    for (const field of line.split(',')) {
      assert.ok(!/["\n\r]/.test(field), `field needs quoting: ${field}`);
    }
  }
});

// ==================== LANDMARK DENORMALIZATION ====================

test('landmarks denormalize against the source resolution, not the canvas', () => {
  // The regression this guards: inference runs on a <=512px canvas, but the CSV
  // stores pixels at the original resolution. Using the canvas size here would
  // shrink every coordinate and misalign the skeleton overlay.
  const raw = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.25, z: 0.1, visibility: 0.8 }));
  const result = computeResult(raw, 1920, 1080, 0, {});

  assert.equal(result.landmarks.nose.x, 960);
  assert.equal(result.landmarks.nose.y, 270);
  assert.equal(result.landmarks.nose.z, 0.1);
  assert.equal(result.landmarks.nose.visibility, 0.8);
});

test('centre-of-mass speed is zero on the first frame and measured after', () => {
  const at = (hipX) => {
    const raw = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
    raw[23] = { x: hipX, y: 0.5, z: 0, visibility: 1 };
    raw[24] = { x: hipX, y: 0.5, z: 0, visibility: 1 };
    return raw;
  };

  const first = computeResult(at(0.5), 1000, 1000, 0, {});
  assert.equal(first.comSpeed, 0, 'no previous frame means no speed');

  // Hip midpoint moves 0.1 * 1000px = 100px over 100ms → 1000 px/s.
  const second = computeResult(at(0.6), 1000, 1000, 100, {
    prevCom: first.com,
    prevTimestampMs: 0,
  });
  assert.ok(Math.abs(second.comSpeed - 1000) < 1e-6, `got ${second.comSpeed}`);
});

test('a 60fps clip read as 30fps loses half the frames — the original bug', () => {
  // Pins the failure mode the branch exists to fix.
  const correct = buildRows(samplesFrom(fixture60.mediaTimes), 60);
  const wrong = buildRows(samplesFrom(fixture60.mediaTimes), 30);

  assert.equal(correct.length, 600);
  assert.equal(wrong.length, 300, 'reading 60fps as 30 should halve the rows');
});
