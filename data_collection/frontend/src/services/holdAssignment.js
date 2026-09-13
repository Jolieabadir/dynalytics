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
 * ⚠️ Landmark contract note. The brief specified a 33-landmark CSV and a
 * `foot_index` point. The CSV this app actually writes has **15** landmarks
 * (see frontend REPORT.md §1.4) and carries **no foot_index** — the lowest
 * foot points available are `left_heel` / `right_heel`, with
 * `left_ankle` / `right_ankle` behind them. So the foot slot is suggested from
 * heels, falling back to ankles. If the CSV ever grows to the full 33-point
 * set, add 'left_foot_index'/'right_foot_index' to the front of FOOT_POINTS
 * and nothing else here changes.
 *
 * Everything in this module is pure: plain objects in, plain objects out, no
 * DOM and no store. That is what makes it directly testable.
 */

/** Foot landmarks, best first. See the note above about foot_index. */
export const FOOT_POINTS = ['left_heel', 'right_heel', 'left_ankle', 'right_ankle'];

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
    const c = boxCenter(hold);
    const distance = Math.hypot(c.x - point.x, c.y - point.y);
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
    const a = normalizedLandmark(startRow, `${side}_wrist`, frameSize);
    const b = normalizedLandmark(endRow, `${side}_wrist`, frameSize);
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

  // Hands at the start frame.
  suggestion.start_left = idOf(
    nearestHold(holds, normalizedLandmark(startRow, 'left_wrist', frameSize), maxDistance)
  );
  suggestion.start_right = idOf(
    nearestHold(holds, normalizedLandmark(startRow, 'right_wrist', frameSize), maxDistance)
  );

  // The reaching hand at the end frame.
  const side = reachingSide(startRow, endRow, frameSize);
  if (side) {
    suggestion.end = idOf(
      nearestHold(holds, normalizedLandmark(endRow, `${side}_wrist`, frameSize), maxDistance)
    );
  }

  // The foot. First foot point that is both present and close to a box wins.
  for (const point of FOOT_POINTS) {
    const hold = nearestHold(
      holds,
      normalizedLandmark(startRow, point, frameSize),
      maxDistance
    );
    if (hold) {
      suggestion.foot = hold.id;
      break;
    }
  }

  return suggestion;
}
