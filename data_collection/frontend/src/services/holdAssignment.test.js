/**
 * MoveForm's four-slot auto-suggest, driven with synthetic landmarks and boxes.
 *
 * This module is a policy layer over holdMatching — these tests cover the slot
 * policy and the landmark preference lists. The geometry it delegates to
 * (distance, normalization, nearest-box) is covered by the holdMatching tests
 * in scripts/test_pose_math.mjs and is deliberately not re-tested here.
 *
 * Layout: a 1000x1000 frame with holds on a grid, and landmarks placed on the
 * hold they should match, so each expectation is obvious on sight.
 */
import { describe, it, expect } from 'vitest';
import {
  suggestHoldSlots,
  reachingSide,
  firstVisibleLandmark,
  handPoints,
  FOOT_POINTS,
  MIN_VISIBILITY,
  SUGGEST_THRESHOLD,
} from './holdAssignment';

const W = 1000;
const H = 1000;

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
    out[`landmark_${name}_x`] = String(nx * W);
    out[`landmark_${name}_y`] = String(ny * H);
    out[`landmark_${name}_z`] = '0';
    out[`landmark_${name}_visibility`] = String(vis);
  }
  return out;
}

const LEFT_HOLD = holdAt(1, 0.30, 0.40);
const RIGHT_HOLD = holdAt(2, 0.70, 0.40);
const TARGET_HOLD = holdAt(3, 0.70, 0.15);
const FOOT_HOLD = holdAt(4, 0.50, 0.85);
const WALL = [LEFT_HOLD, RIGHT_HOLD, TARGET_HOLD, FOOT_HOLD];

describe('preference lists', () => {
  it('prefers the fingertip to the wrist', () => {
    expect(handPoints('left')).toEqual(['left_index', 'left_wrist']);
    expect(handPoints('right')).toEqual(['right_index', 'right_wrist']);
  });

  it('prefers the toe, then the heel, then the ankle', () => {
    expect(FOOT_POINTS[0]).toBe('left_foot_index');
    expect(FOOT_POINTS.indexOf('left_heel')).toBeLessThan(
      FOOT_POINTS.indexOf('left_ankle')
    );
  });
});

describe('firstVisibleLandmark', () => {
  it('returns pixel coordinates, not normalized ones', () => {
    // Normalization belongs to holdMatching; this must hand it raw pixels.
    const r = row({ left_wrist: [0.25, 0.5] });
    expect(firstVisibleLandmark(r, ['left_wrist'])).toMatchObject({ x: 250, y: 500 });
  });

  it('takes the first name that is present', () => {
    const r = row({ left_wrist: [0.25, 0.5] }); // no left_index
    expect(firstVisibleLandmark(r, handPoints('left'))).toMatchObject({ x: 250 });
  });

  it('prefers an earlier name when both are present', () => {
    const r = row({ left_index: [0.10, 0.10], left_wrist: [0.25, 0.5] });
    expect(firstVisibleLandmark(r, handPoints('left'))).toMatchObject({ x: 100 });
  });

  it('skips a landmark below the visibility floor', () => {
    const r = row({
      left_index: [0.10, 0.10, MIN_VISIBILITY - 0.01],
      left_wrist: [0.25, 0.5],
    });
    expect(firstVisibleLandmark(r, handPoints('left'))).toMatchObject({ x: 250 });
  });

  it('returns null when nothing in the list is present', () => {
    expect(firstVisibleLandmark(row({}), handPoints('left'))).toBeNull();
  });

  it('treats an empty cell as absent, not as a limb at the origin', () => {
    // Number('') is 0, which would otherwise be a phantom limb at (0,0).
    const r = row({ left_wrist: [0.25, 0.5] });
    r.landmark_left_wrist_x = '';
    r.landmark_left_wrist_y = '';
    expect(firstVisibleLandmark(r, ['left_wrist'])).toBeNull();
  });
});

describe('reachingSide', () => {
  it('is the hand that travelled further', () => {
    const start = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.40] });
    const end = row({ left_wrist: [0.31, 0.40], right_wrist: [0.70, 0.15] });
    expect(reachingSide(start, end, W, H)).toBe('right');
  });

  it('is the other side when the left hand reaches', () => {
    const start = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.40] });
    const end = row({ left_wrist: [0.30, 0.10], right_wrist: [0.70, 0.41] });
    expect(reachingSide(start, end, W, H)).toBe('left');
  });

  it('falls back to the only measurable side', () => {
    const start = row({ right_wrist: [0.70, 0.40] });
    const end = row({ right_wrist: [0.70, 0.15] });
    expect(reachingSide(start, end, W, H)).toBe('right');
  });

  it('is null when neither hand can be measured', () => {
    expect(reachingSide(row({}), row({}), W, H)).toBeNull();
  });

  it('is null on an exact tie rather than guessing', () => {
    const start = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.40] });
    const end = row({ left_wrist: [0.30, 0.30], right_wrist: [0.70, 0.30] });
    expect(reachingSide(start, end, W, H)).toBeNull();
  });

  it('is null when the frame size is unknown', () => {
    const start = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.40] });
    const end = row({ left_wrist: [0.30, 0.10], right_wrist: [0.70, 0.41] });
    expect(reachingSide(start, end, 0, 0)).toBeNull();
  });

  it('accounts for a non-square frame', () => {
    // Equal pixel travel: 100px across on a 1000-wide frame is 0.1 normalized;
    // 100px down on a 2000-tall frame is only 0.05. The wider-travelling hand
    // must win on normalized distance, not raw pixels.
    const start = {
      ...row({}),
      landmark_left_wrist_x: '0', landmark_left_wrist_y: '0',
      landmark_left_wrist_visibility: '1',
      landmark_right_wrist_x: '0', landmark_right_wrist_y: '0',
      landmark_right_wrist_visibility: '1',
    };
    const end = {
      ...start,
      landmark_left_wrist_x: '100', landmark_left_wrist_y: '0',
      landmark_right_wrist_x: '0', landmark_right_wrist_y: '100',
    };
    expect(reachingSide(start, end, 1000, 2000)).toBe('left');
  });
});

describe('suggestHoldSlots', () => {
  it('assigns both hands at the start frame and the reaching hand at the end', () => {
    const startRow = row({
      left_wrist: [0.30, 0.40],
      right_wrist: [0.70, 0.40],
      left_heel: [0.50, 0.85],
    });
    const endRow = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.15] });

    expect(suggestHoldSlots({ holds: WALL, startRow, endRow, width: W, height: H })).toEqual({
      start_left: 1,
      start_right: 2,
      end: 3,
      foot: 4,
    });
  });

  it('uses the fingertip in preference to the wrist', () => {
    // Fingertip on the left hold, wrist trailing over by the right one.
    const startRow = row({
      left_index: [0.30, 0.40],
      left_wrist: [0.70, 0.40],
      right_index: [0.70, 0.40],
    });
    const endRow = row({ left_index: [0.30, 0.40], right_index: [0.70, 0.15] });

    const out = suggestHoldSlots({ holds: WALL, startRow, endRow, width: W, height: H });
    expect(out.start_left).toBe(1);
  });

  it('still works on the 15-landmark CSV, which has no fingertip or toe', () => {
    const startRow = row({
      left_wrist: [0.30, 0.40],
      right_wrist: [0.70, 0.40],
      left_heel: [0.50, 0.85],
    });
    const endRow = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.15] });

    expect(suggestHoldSlots({ holds: WALL, startRow, endRow, width: W, height: H })).toEqual({
      start_left: 1, start_right: 2, end: 3, foot: 4,
    });
  });

  it('falls down the foot list as points become invisible', () => {
    const endRow = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.15] });
    const base = { left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.40] };

    const ankleOnly = row({
      ...base,
      left_heel: [0.50, 0.85, 0.1], // present but occluded
      right_ankle: [0.50, 0.85],
    });
    expect(
      suggestHoldSlots({ holds: WALL, startRow: ankleOnly, endRow, width: W, height: H }).foot
    ).toBe(4);

    const withToe = row({ ...base, left_foot_index: [0.50, 0.85] });
    expect(
      suggestHoldSlots({ holds: WALL, startRow: withToe, endRow, width: W, height: H }).foot
    ).toBe(4);
  });

  it('leaves a slot null when no box is near enough', () => {
    const startRow = row({
      left_wrist: [0.30, 0.40],
      right_wrist: [0.02, 0.98], // nowhere near a hold
    });
    const endRow = row({ left_wrist: [0.30, 0.10], right_wrist: [0.02, 0.98] });

    const out = suggestHoldSlots({ holds: WALL, startRow, endRow, width: W, height: H });
    expect(out.start_left).toBe(1);
    expect(out.start_right).toBeNull();
  });

  it('respects the distance threshold', () => {
    const startRow = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.40] });
    const endRow = startRow;
    const tight = suggestHoldSlots({
      holds: [holdAt(9, 0.45, 0.40)], // ~0.12 from the left wrist
      startRow, endRow, width: W, height: H,
      threshold: 0.02,
    });
    expect(tight.start_left).toBeNull();

    const loose = suggestHoldSlots({
      holds: [holdAt(9, 0.45, 0.40)],
      startRow, endRow, width: W, height: H,
      threshold: SUGGEST_THRESHOLD,
    });
    expect(loose.start_left).toBe(9);
  });

  it('suggests nothing at all when there are no holds', () => {
    const r = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.40] });
    expect(suggestHoldSlots({ holds: [], startRow: r, endRow: r, width: W, height: H })).toEqual({
      start_left: null, start_right: null, end: null, foot: null,
    });
  });

  it('suggests nothing when the frame size is unknown', () => {
    // holdMatching refuses rather than assuming a resolution; that refusal has
    // to survive all the way out to the slots.
    const r = row({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.40] });
    expect(suggestHoldSlots({ holds: WALL, startRow: r, endRow: r, width: 0, height: 0 })).toEqual({
      start_left: null, start_right: null, end: null, foot: null,
    });
  });

  it('does not blow up on a pose-less frame', () => {
    const empty = row({});
    expect(
      suggestHoldSlots({ holds: WALL, startRow: empty, endRow: empty, width: W, height: H })
    ).toEqual({ start_left: null, start_right: null, end: null, foot: null });
  });

  it('resolves the same contact identically at any resolution', () => {
    // True only because landmarks are normalized before comparison — the
    // property the holdMatching layering exists to protect.
    const at = (w, h) => {
      const scale = (pts) => {
        const out = { frame_number: '0' };
        for (const [name, [nx, ny]] of Object.entries(pts)) {
          out[`landmark_${name}_x`] = String(nx * w);
          out[`landmark_${name}_y`] = String(ny * h);
          out[`landmark_${name}_visibility`] = '1';
        }
        return out;
      };
      const s = scale({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.40] });
      const e = scale({ left_wrist: [0.30, 0.40], right_wrist: [0.70, 0.15] });
      return suggestHoldSlots({ holds: WALL, startRow: s, endRow: e, width: w, height: h });
    };

    const expected = { start_left: 1, start_right: 2, end: 3, foot: null };
    expect(at(1920, 1080)).toEqual(expected);
    expect(at(3840, 2160)).toEqual(expected);
    expect(at(720, 1280)).toEqual(expected);
  });
});
