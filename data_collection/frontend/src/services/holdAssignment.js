/**
 * Auto-suggesting which hold goes in which slot, from the pose CSV.
 *
 * At the move's start frame the hands are on their starting holds; at the end
 * frame the reaching hand is on the target. So:
 *
 *   start_left   ← box nearest the left wrist  at frame_start
 *   start_right  ← box nearest the right wrist at frame_start
 *   end          ← box nearest the reaching wrist at frame_end
 *   foot         ← box nearest either foot point at frame_start
 *
 * Landmark contract. This works against BOTH widths of the pose CSV, because
 * the two exist side by side right now:
 *
 *   - the 15-landmark CSV this branch was cut from — wrists, heels, ankles,
 *     and no fingertip or toe;
 *   - the 33-landmark CSV that landed on feat/pose-extractor-v2 while this
 *     branch was in flight, which adds `*_index` fingertip and toe points.
 *
 * So each slot walks a preference list and takes the first point that is
 * actually present and visible: fingertip before wrist, toe before heel before
 * ankle. A fingertip sits much closer to the hold the climber is really on, so
 * when the 33-landmark CSV is in play the suggestions get better for free, and
 * nothing breaks when it is not.
 *
 * ⚠️ See REPORT.md §C9: feat/pose-extractor-v2 also gained
 * `src/services/holdMatching.js`, a tested-but-unwired primitives module that
 * overlaps this one. These need reconciling into a single module at merge —
 * the distance function here was deliberately converged onto theirs to make
 * that a deletion rather than a rewrite.
 *
 * Everything in this module is pure: plain objects in, plain objects out, no
 * DOM and no store. That is what makes it directly testable.
 */

/**
 * Foot landmarks, best first: toe, then heel, then ankle.
 * `*_foot_index` exists only in the 33-landmark CSV — see the header.
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
 * actually contacts the hold; the wrist is up to a hand's width away from it,
 * so it is the fallback rather than the first choice.
 */
export function handPoints(side) {
  return [`${side}_index`, `${side}_wrist`];
}

/**
 * First point in a preference list that is present and visible enough.
 * @returns {{x:number,y:number}|null} normalized
 */
export function firstVisiblePoint(row, names, frameSize) {
  for (const name of names) {
    const point = normalizedLandmark(row, name, frameSize);
    if (point) return point;
  }
  return null;
}

/** Minimum MediaPipe visibility before a landmark is trusted for a suggestion. */
export const MIN_VISIBILITY = 0.5;

/**
 * Read one landmark from a parsed CSV row.
 *
 * Rows come from the CSV as strings. Coordinates are **pixels in the original
 * video resolution**, so they must be normalized against the frame size before
 * being compared with a hold's 0-1 box.
 *
 * @returns {{x:number,y:number,visibility:number}|null}
 */
export function landmarkFromRow(row, name) {
  if (!row) return null;
  const x = Number(row[`landmark_${name}_x`]);
  const y = Number(row[`landmark_${name}_y`]);
  const rawVis = row[`landmark_${name}_visibility`];
  const visibility = rawVis === '' || rawVis == null ? 0 : Number(rawVis);

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, visibility: Number.isFinite(visibility) ? visibility : 0 };
}

/**
 * Landmark in normalized 0-1 space, or null when absent or too uncertain.
 *
 * @param {object} row - parsed CSV row
 * @param {string} name - landmark name, e.g. 'left_wrist'
 * @param {{width:number,height:number}} frameSize - original video resolution
 */
export function normalizedLandmark(row, name, frameSize) {
  const lm = landmarkFromRow(row, name);
  if (!lm) return null;
  if (lm.visibility < MIN_VISIBILITY) return null;
  if (!frameSize?.width || !frameSize?.height) return null;
  return { x: lm.x / frameSize.width, y: lm.y / frameSize.height };
}

/** Centre of a normalized hold box. */
export function boxCenter(hold) {
  return { x: hold.bbox_x + hold.bbox_w / 2, y: hold.bbox_y + hold.bbox_h / 2 };
}

/**
 * Shortest distance from a normalized point to a hold box; 0 when inside.
 *
 * Point-to-rectangle rather than point-to-centre, deliberately: with centre
 * distance a big hold the hand is resting *inside* can lose to a small hold
 * further away, which is exactly backwards.
 */
export function distanceToBox(point, hold) {
  const right = hold.bbox_x + hold.bbox_w;
  const bottom = hold.bbox_y + hold.bbox_h;
  const dx = Math.max(hold.bbox_x - point.x, 0, point.x - right);
  const dy = Math.max(hold.bbox_y - point.y, 0, point.y - bottom);
  return Math.hypot(dx, dy);
}

/**
 * The hold whose centre is closest to a normalized point.
 *
 * `maxDistance` guards against assigning a hold on the far side of the wall
 * when the real one was never detected — better to suggest nothing than to
 * suggest something wrong, since a wrong suggestion still has to be noticed and
 * undone.
 *
 * @returns {object|null} the hold, or null
 */
export function nearestHold(holds, point, maxDistance = 0.15) {
  if (!point || !Array.isArray(holds) || holds.length === 0) return null;

  let best = null;
  let bestDistance = Infinity;

  for (const hold of holds) {
    const distance = distanceToBox(point, hold);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = hold;
    }
  }

  if (best === null || bestDistance > maxDistance) return null;
  return best;
}

/**
 * Which wrist is doing the reaching.
 *
 * The reaching hand is the one that travels furthest between the start and end
 * frames. Ties and missing landmarks fall back to null, which makes the `end`
 * slot simply go unsuggested.
 *
 * @returns {'left'|'right'|null}
 */
export function reachingSide(startRow, endRow, frameSize) {
  const travel = (side) => {
    const names = handPoints(side);
    const a = firstVisiblePoint(startRow, names, frameSize);
    const b = firstVisiblePoint(endRow, names, frameSize);
    if (!a || !b) return null;
    return Math.hypot(b.x - a.x, b.y - a.y);
  };

  const left = travel('left');
  const right = travel('right');

  if (left == null && right == null) return null;
  if (left == null) return 'right';
  if (right == null) return 'left';
  if (left === right) return null;
  return left > right ? 'left' : 'right';
}

/**
 * Suggest a hold for each of the four slots.
 *
 * @param {object} params
 * @param {Array} params.holds - holds with normalized bbox_* fields
 * @param {object} params.startRow - parsed CSV row at the move's start frame
 * @param {object} params.endRow - parsed CSV row at the move's end frame
 * @param {{width:number,height:number}} params.frameSize - original resolution
 * @param {number} [params.maxDistance]
 * @returns {{start_left:?number, start_right:?number, end:?number, foot:?number}}
 *          hold ids, null where nothing was close enough to suggest
 */
export function suggestHoldSlots({ holds, startRow, endRow, frameSize, maxDistance = 0.15 }) {
  const suggestion = { start_left: null, start_right: null, end: null, foot: null };
  if (!Array.isArray(holds) || holds.length === 0) return suggestion;

  const idOf = (hold) => (hold ? hold.id : null);

  // Hands at the start frame — fingertip if the CSV has one, else the wrist.
  suggestion.start_left = idOf(
    nearestHold(holds, firstVisiblePoint(startRow, handPoints('left'), frameSize), maxDistance)
  );
  suggestion.start_right = idOf(
    nearestHold(holds, firstVisiblePoint(startRow, handPoints('right'), frameSize), maxDistance)
  );

  // The reaching hand at the end frame.
  const side = reachingSide(startRow, endRow, frameSize);
  if (side) {
    suggestion.end = idOf(
      nearestHold(holds, firstVisiblePoint(endRow, handPoints(side), frameSize), maxDistance)
    );
  }

  // The foot. First foot point that is both visible and close to a box wins,
  // in preference order: toe, then heel, then ankle.
  for (const name of FOOT_POINTS) {
    const hold = nearestHold(
      holds,
      normalizedLandmark(startRow, name, frameSize),
      maxDistance
    );
    if (hold) {
      suggestion.foot = hold.id;
      break;
    }
  }

  return suggestion;
}
