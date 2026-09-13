/**
 * Nearest-box hold assignment, driven with synthetic landmarks and boxes.
 *
 * The geometry is laid out by hand so each expectation is obvious on sight:
 * a 1000x1000 frame, holds on a grid, and wrists placed right on top of the
 * hold they should match.
 */
import { describe, it, expect } from 'vitest';
import {
  boxCenter,
  nearestHold,
  normalizedLandmark,
  reachingSide,
  suggestHoldSlots,
  FOOT_POINTS,
  MIN_VISIBILITY,
} from './holdAssignment';

const FRAME = { width: 1000, height: 1000 };

/** A hold whose centre sits at (cx, cy) in normalized space. */
const holdAt = (id, cx, cy, size = 0.06) => ({
  id,
  bbox_x: cx - size / 2,
  bbox_y: cy - size / 2,
  bbox_w: size,
  bbox_h: size,
});

/**
 * Build a CSV row. Coordinates are given normalized for readability and
 * written out as pixels, which is what the real CSV contains.
 */
function row(points) {
  const out = { frame_number: '0', timestamp_ms: '0' };
  for (const [name, [nx, ny, vis = 1]] of Object.entries(points)) {
    out[`landmark_${name}_x`] = String(nx * FRAME.width);
    out[`landmark_${name}_y`] = String(ny * FRAME.height);
    out[`landmark_${name}_z`] = '0';
    out[`landmark_${name}_visibility`] = String(vis);
  }
  return out;
}

// The wall used by most tests.
const LEFT_HOLD = holdAt(1, 0.30, 0.40);
const RIGHT_HOLD = holdAt(2, 0.70, 0.40);
const TARGET_HOLD = holdAt(3, 0.70, 0.15);
const FOOT_HOLD = holdAt(4, 0.50, 0.85);
const WALL = [LEFT_HOLD, RIGHT_HOLD, TARGET_HOLD, FOOT_HOLD];

describe('boxCenter', () => {
  it('returns the middle of the box', () => {
    expect(boxCenter({ bbox_x: 0.2, bbox_y: 0.4, bbox_w: 0.1, bbox_h: 0.2 })).toEqual({
      x: 0.25,
      y: 0.5,
    });
  });
});

describe('normalizedLandmark', () => {
  it('converts pixel coordinates to 0-1 against the original resolution', () => {
    const r = row({ left_wrist: [0.25, 0.5] });
    expect(normalizedLandmark(r, 'left_wrist', FRAME)).toEqual({ x: 0.25, y: 0.5 });
  });

  it('rejects a landmark below the visibility floor', () => {
    const r = row({ left_wrist: [0.25, 0.5, MIN_VISIBILITY - 0.01] });
    expect(normalizedLandmark(r, 'left_wrist', FRAME)).toBeNull();
  });

  it('returns null for an absent landmark', () => {
    expect(normalizedLandmark(row({}), 'left_wrist', FRAME)).toBeNull();
  });

  it('returns null when the frame size is unknown', () => {
    const r = row({ left_wrist: [0.25, 0.5] });
    expect(normalizedLandmark(r, 'left_wrist', { width: 0, height: 0 })).toBeNull();
  });

  it('treats an empty visibility cell as not visible', () => {
    // A pose-less frame writes '' for every landmark column.
    const r = row({ left_wrist: [0.25, 0.5] });
    r.landmark_left_wrist_visibility = '';
    expect(normalizedLandmark(r, 'left_wrist', FRAME)).toBeNull();
  });
});

describe('nearestHold', () => {
  it('picks the closest box', () => {
    expect(nearestHold(WALL, { x: 0.31, y: 0.41 })).toBe(LEFT_HOLD);
    expect(nearestHold(WALL, { x: 0.69, y: 0.39 })).toBe(RIGHT_HOLD);
  });

  it('returns null when everything is further away than the cap', () => {
    // Bottom-left corner: nothing within 0.15.
    expect(nearestHold(WALL, { x: 0.02, y: 0.02 })).toBeNull();
  });

  it('respects a custom cap', () => {
    const point = { x: 0.30, y: 0.55 }; // 0.15 from LEFT_HOLD's centre
    expect(nearestHold(WALL, point, 0.2)).toBe(LEFT_HOLD);
    expect(nearestHold(WALL, point, 0.05)).toBeNull();
  });

  it('returns null for no point or no holds', () => {
    expect(nearestHold(WALL, null)).toBeNull();
    expect(nearestHold([], { x: 0.5, y: 0.5 })).toBeNull();
  });
});

describe('reachingSide', () => {
  it('is the wrist that travelled further', () => {
    const start = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.40] });
    const end = row({ left_wrist: [0.31, 0.40], right_wrist: [0.70, 0.15] });
    expect(reachingSide(start, end, FRAME)).toBe('right');
  });

  it('is the other side when the left hand does the reaching', () => {
    const start = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.40] });
    const end = row({ left_wrist: [0.30, 0.10], right_wrist: [0.70, 0.41] });
    expect(reachingSide(start, end, FRAME)).toBe('left');
  });

  it('falls back to the only measurable side', () => {
    const start = row({ right_wrist: [0.70, 0.40] });
    const end = row({ right_wrist: [0.70, 0.15] });
    expect(reachingSide(start, end, FRAME)).toBe('right');
  });

  it('is null when neither wrist can be measured', () => {
    expect(reachingSide(row({}), row({}), FRAME)).toBeNull();
  });

  it('is null on an exact tie, rather than guessing', () => {
    const start = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.40] });
    const end = row({ left_wrist: [0.30, 0.30], right_wrist: [0.70, 0.30] });
    expect(reachingSide(start, end, FRAME)).toBeNull();
  });
});

describe('suggestHoldSlots', () => {
  it('assigns both hands at the start frame and the reaching hand at the end', () => {
    const startRow = row({
      left_wrist: [0.30, 0.40],
      right_wrist: [0.70, 0.40],
      left_heel: [0.50, 0.85],
    });
    const endRow = row({
      left_wrist: [0.30, 0.40],
      right_wrist: [0.70, 0.15],
    });

    expect(suggestHoldSlots({ holds: WALL, startRow, endRow, frameSize: FRAME })).toEqual({
      start_left: 1,
      start_right: 2,
      end: 3,
      foot: 4,
    });
  });

  it('leaves a slot null when no box is near enough', () => {
    // Right wrist out on its own in the corner, nowhere near a hold.
    const startRow = row({
      left_wrist: [0.30, 0.40],
      right_wrist: [0.02, 0.98],
    });
    const endRow = row({ left_wrist: [0.30, 0.10], right_wrist: [0.02, 0.98] });

    const out = suggestHoldSlots({ holds: WALL, startRow, endRow, frameSize: FRAME });
    expect(out.start_left).toBe(1);
    expect(out.start_right).toBeNull();
  });

  it('suggests nothing at all when there are no holds', () => {
    const r = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.40] });
    expect(suggestHoldSlots({ holds: [], startRow: r, endRow: r, frameSize: FRAME })).toEqual({
      start_left: null,
      start_right: null,
      end: null,
      foot: null,
    });
  });

  it('falls back to the ankle when no heel is visible', () => {
    // The shipped CSV has no foot_index, so heels lead and ankles back them up.
    expect(FOOT_POINTS[0]).toBe('left_heel');
    expect(FOOT_POINTS).toContain('left_ankle');

    const startRow = row({
      left_wrist: [0.30, 0.40],
      right_wrist: [0.70, 0.40],
      left_heel: [0.50, 0.85, 0.1], // present but not visible enough
      right_ankle: [0.50, 0.85],
    });
    const endRow = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.15] });

    const out = suggestHoldSlots({ holds: WALL, startRow, endRow, frameSize: FRAME });
    expect(out.foot).toBe(4);
  });

  it('does not blow up on a pose-less start frame', () => {
    const empty = row({});
    const out = suggestHoldSlots({
      holds: WALL,
      startRow: empty,
      endRow: empty,
      frameSize: FRAME,
    });
    expect(out).toEqual({ start_left: null, start_right: null, end: null, foot: null });
  });

  it('suggests nothing when the frame size is unknown', () => {
    // Without the original resolution, pixel coordinates cannot be normalized.
    const r = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.40] });
    const out = suggestHoldSlots({
      holds: WALL,
      startRow: r,
      endRow: r,
      frameSize: { width: 0, height: 0 },
    });
    expect(out).toEqual({ start_left: null, start_right: null, end: null, foot: null });
  });
});
