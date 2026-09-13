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
  distanceToBox,
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

describe('distanceToBox', () => {
  it('is zero for a point inside the box', () => {
    expect(distanceToBox({ x: 0.30, y: 0.40 }, LEFT_HOLD)).toBe(0);
  });

  it('measures to the edge, not the centre', () => {
    // 0.1 to the left of a box whose left edge is at 0.27.
    expect(distanceToBox({ x: 0.17, y: 0.40 }, LEFT_HOLD)).toBeCloseTo(0.10, 6);
  });

  it('prefers a big hold the hand is inside over a small one further off', () => {
    // The exact failure point-to-centre distance would get wrong.
    const big = { id: 10, bbox_x: 0.20, bbox_y: 0.20, bbox_w: 0.30, bbox_h: 0.30 };
    const small = { id: 11, bbox_x: 0.52, bbox_y: 0.34, bbox_w: 0.02, bbox_h: 0.02 };
    const insideBig = { x: 0.48, y: 0.35 };

    // Centre distance would pick `small`; edge distance correctly picks `big`.
    expect(nearestHold([big, small], insideBig)).toBe(big);
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

  it('prefers the toe, then the heel, then the ankle', () => {
    // The 33-landmark CSV has foot_index; the 15-landmark one does not. The
    // preference list has to cover both.
    expect(FOOT_POINTS[0]).toBe('left_foot_index');
    expect(FOOT_POINTS).toContain('left_heel');
    expect(FOOT_POINTS).toContain('left_ankle');
    expect(FOOT_POINTS.indexOf('left_heel')).toBeLessThan(
      FOOT_POINTS.indexOf('left_ankle')
    );
  });

  it('falls back down the foot list as points become invisible', () => {
    const endRow = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.15] });
    const base = { left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.40] };

    // Only an ankle is usable: heel present but below the visibility floor.
    const ankleOnly = row({
      ...base,
      left_heel: [0.50, 0.85, 0.1],
      right_ankle: [0.50, 0.85],
    });
    expect(
      suggestHoldSlots({ holds: WALL, startRow: ankleOnly, endRow, frameSize: FRAME }).foot
    ).toBe(4);

    // With a toe visible it is used too — same hold, via the preferred point.
    const withToe = row({ ...base, left_foot_index: [0.50, 0.85] });
    expect(
      suggestHoldSlots({ holds: WALL, startRow: withToe, endRow, frameSize: FRAME }).foot
    ).toBe(4);
  });

  it('uses the fingertip in preference to the wrist when the CSV has one', () => {
    // 33-landmark CSV: the fingertip is on the hold, the wrist trails behind
    // it and is nearer a different hold. The fingertip must win.
    const startRow = row({
      left_index: [0.30, 0.40], // on LEFT_HOLD
      left_wrist: [0.70, 0.40], // nearer RIGHT_HOLD
      right_index: [0.70, 0.40],
      right_wrist: [0.70, 0.40],
    });
    const endRow = row({ left_index: [0.30, 0.40], right_index: [0.70, 0.15] });

    const out = suggestHoldSlots({ holds: WALL, startRow, endRow, frameSize: FRAME });
    expect(out.start_left).toBe(1);
  });

  it('still works on the 15-landmark CSV, which has no fingertip or toe', () => {
    const startRow = row({
      left_wrist: [0.30, 0.40],
      right_wrist: [0.70, 0.40],
      left_heel: [0.50, 0.85],
    });
    const endRow = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.15] });

    expect(suggestHoldSlots({ holds: WALL, startRow, endRow, frameSize: FRAME })).toEqual({
      start_left: 1,
      start_right: 2,
      end: 3,
      foot: 4,
    });
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
