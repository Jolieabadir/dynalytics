/**
 * Suggesting which hold belongs in each of MoveForm's four slots.
 *
 * This is a **policy layer only**. Every coordinate decision — the
 * pixel→normalized conversion, point-to-box distance, "which box is nearest" —
 * belongs to `holdMatching.js`, which is the single source of geometry. Row
 * parsing belongs to `holdSuggestions.js`. Nothing here does arithmetic on a
 * coordinate; if a suggestion lands in the wrong place, the bug is in the
 * inputs or in holdMatching, never in this file.
 *
 * What it *does* own is the slot policy, which is specific to defining a move
 * and has no equivalent on the tagging side:
 *
 *   start_left   ← the left hand at the move's start frame
 *   start_right  ← the right hand at the move's start frame
 *   end          ← the reaching hand at the move's end frame
 *   foot         ← a foot at the start frame
 *
 * and the landmark preference lists that make it work across both widths of
 * the pose CSV: fingertip before wrist, toe before heel before ankle. The
 * 33-landmark CSV has `*_index` and `*_foot_index`; the 15-landmark one it
 * replaced had only wrists, heels and ankles. Taking the first point that is
 * actually present means the newer CSV improves suggestions for free without
 * the older one breaking.
 */
import { nearestHold } from './holdMatching.js';
import { landmarkFromRow } from './holdSuggestions.js';
import { normalizeLandmark } from './poseMath.js';

/**
 * How close a landmark must be to a box to be worth suggesting, in normalized
 * units. Deliberately looser than holdSuggestions' CONTACT_THRESHOLD (0.04):
 * that answers "is the climber touching this hold right now", which wants to be
 * strict, while this answers "which hold is this move about", where a
 * near-miss is still the right hold and the labeller confirms it anyway.
 */
export const SUGGEST_THRESHOLD = 0.15;

/** Minimum MediaPipe visibility before a landmark is trusted for a suggestion. */
export const MIN_VISIBILITY = 0.5;

/**
 * Foot landmarks, best first: toe, then heel, then ankle.
 * `*_foot_index` exists only in the 33-landmark CSV.
 */
export const FOOT_POINTS = [
  'left_foot_index',
  'right_foot_index',
  'left_heel',
  'right_heel',
  'left_ankle',
  'right_ankle',
];

/**
 * Hand landmarks for one side, best first. The fingertip (`*_index`) is what
 * actually contacts the hold; the wrist trails up to a hand's width behind it,
 * so it is the fallback rather than the first choice.
 */
export function handPoints(side) {
  return [`${side}_index`, `${side}_wrist`];
}

/**
 * First landmark in a preference list that is present and visible enough.
 *
 * Returns it in **pixel** space, exactly as it sits in the CSV — normalization
 * is holdMatching's job, and doing it here would be the duplication this
 * module exists to avoid.
 *
 * @returns {{x:number,y:number,visibility:number|null}|null}
 */
export function firstVisibleLandmark(row, names, minVisibility = MIN_VISIBILITY) {
  for (const name of names) {
    const lm = landmarkFromRow(row, name);
    if (!lm) continue;
    // A null visibility means the column is absent rather than low — trust it.
    if (lm.visibility !== null && lm.visibility < minVisibility) continue;
    return lm;
  }
  return null;
}

/**
 * Which hand is doing the reaching: the one that travels further between the
 * start and end frames.
 *
 * No box is involved, so this is the one comparison nearestHold cannot do for
 * us — but it still has to be scale-correct on a non-square frame, so both
 * points go through poseMath's `normalizeLandmark`, the same primitive
 * holdMatching itself uses. A tie, or a hand that cannot be measured on both
 * frames, returns null and the `end` slot simply goes unsuggested.
 *
 * @returns {'left'|'right'|null}
 */
export function reachingSide(startRow, endRow, width, height) {
  const travel = (side) => {
    const names = handPoints(side);
    const a = normalizeLandmark(firstVisibleLandmark(startRow, names), width, height);
    const b = normalizeLandmark(firstVisibleLandmark(endRow, names), width, height);
    if (!a || !b) return null;
    return Math.hypot(b.x - a.x, b.y - a.y);
  };

  const left = travel('left');
  const right = travel('right');

  if (left === null && right === null) return null;
  if (left === null) return 'right';
  if (right === null) return 'left';
  if (left === right) return null;
  return left > right ? 'left' : 'right';
}

/**
 * Suggest a hold id for each of the four slots.
 *
 * Every match is delegated to `holdMatching.nearestHold`, which takes pixel
 * landmarks plus the frame size and refuses (returns null) when the size is
 * unknown rather than guessing — so a pre-migration video with no width/height
 * suggests nothing at all, which is the correct behaviour.
 *
 * @param {object} params
 * @param {Array} params.holds holds with normalized bbox_* fields
 * @param {object} params.startRow parsed CSV row at the move's start frame
 * @param {object} params.endRow parsed CSV row at the move's end frame
 * @param {number} params.width intrinsic video width in pixels
 * @param {number} params.height intrinsic video height in pixels
 * @param {number} [params.threshold] normalized max distance
 * @returns {{start_left:?number, start_right:?number, end:?number, foot:?number}}
 *          hold ids, null where nothing was close enough to suggest
 */
export function suggestHoldSlots({
  holds,
  startRow,
  endRow,
  width,
  height,
  threshold = SUGGEST_THRESHOLD,
  minVisibility = MIN_VISIBILITY,
}) {
  const suggestion = { start_left: null, start_right: null, end: null, foot: null };
  if (!holds?.length) return suggestion;

  const match = (row, names) => {
    const lm = firstVisibleLandmark(row, names, minVisibility);
    const hit = nearestHold(lm, holds, width, height, { maxDistance: threshold });
    return hit ? hit.hold.id : null;
  };

  // Hands at the start frame.
  suggestion.start_left = match(startRow, handPoints('left'));
  suggestion.start_right = match(startRow, handPoints('right'));

  // The reaching hand at the end frame.
  const side = reachingSide(startRow, endRow, width, height);
  if (side) suggestion.end = match(endRow, handPoints(side));

  // The foot: first foot point that is both visible and close to a box wins,
  // in preference order.
  for (const name of FOOT_POINTS) {
    const id = match(startRow, [name]);
    if (id !== null) {
      suggestion.foot = id;
      break;
    }
  }

  return suggestion;
}
