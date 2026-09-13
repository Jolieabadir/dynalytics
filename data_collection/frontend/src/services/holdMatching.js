/**
 * Matching pose landmarks against hold bounding boxes.
 *
 * ⚠️ NOT WIRED UP. Nothing in the app calls this yet — there is no hold
 * detection or hold-tagging UI on this branch, and `/api/holds` is CRUD only
 * with no matching on the backend either. This exists so that whoever builds
 * that feature starts from the correct coordinate handling rather than
 * rediscovering the unit mismatch below.
 *
 * The mismatch: pose landmarks are stored as PIXELS at source resolution
 * (`computeResult` multiplies MediaPipe's normalized output by videoWidth /
 * videoHeight), while `public.holds` stores `bbox_*` NORMALIZED to 0-1. Compare
 * them directly and a 1920x1080 wrist at x=960 reads as 960 units from a hold
 * at bbox_x=0.5 — every hold looks impossibly far away, and "nearest" becomes
 * whichever box happens to be nearest the origin. Every entry point here takes
 * the frame size and normalizes first.
 */
import { normalizeLandmark } from './poseMath.js';

/**
 * Shortest distance from a point to an axis-aligned box, 0 when inside.
 *
 * Point-to-rectangle rather than point-to-centre: with centre distance a large
 * hold the hand is resting inside can lose to a small hold further away, which
 * is exactly backwards.
 *
 * All values normalized 0-1. Boxes are {bbox_x, bbox_y, bbox_w, bbox_h} with
 * x/y the top-left corner, matching the holds table.
 */
export function distanceToBox(point, box) {
  const left = box.bbox_x;
  const top = box.bbox_y;
  const right = box.bbox_x + box.bbox_w;
  const bottom = box.bbox_y + box.bbox_h;

  // 0 on an axis where the point is within the box's span.
  const dx = Math.max(left - point.x, 0, point.x - right);
  const dy = Math.max(top - point.y, 0, point.y - bottom);

  return Math.hypot(dx, dy);
}

/** Whether a normalized point falls inside a box. */
export function isInsideBox(point, box) {
  return (
    point.x >= box.bbox_x &&
    point.x <= box.bbox_x + box.bbox_w &&
    point.y >= box.bbox_y &&
    point.y <= box.bbox_y + box.bbox_h
  );
}

/**
 * Nearest hold to one landmark.
 *
 * @param {{x: number, y: number}} landmark in PIXELS, straight off a CSV row or
 *   a computeResult landmark map
 * @param {Array<{bbox_x, bbox_y, bbox_w, bbox_h}>} holds normalized 0-1
 * @param {number} width intrinsic video width in pixels
 * @param {number} height intrinsic video height in pixels
 * @param {{maxDistance?: number}} [options] maxDistance is in NORMALIZED units
 *   (0.1 is a tenth of the frame); beyond it, nothing matches
 * @returns {{hold, distance, inside, index}|null} null when there are no holds,
 *   when the frame size is unknown, or when nothing is within maxDistance
 */
export function nearestHold(landmark, holds, width, height, options = {}) {
  const { maxDistance = Infinity } = options;

  if (!landmark || !holds?.length) return null;

  // Unknown frame size: refuse rather than guess. Guessing would produce a
  // confident, wrong answer, which is worse than none.
  const point = normalizeLandmark(landmark, width, height);
  if (!point) return null;

  let best = null;
  for (let index = 0; index < holds.length; index++) {
    const hold = holds[index];
    const distance = distanceToBox(point, hold);
    if (distance > maxDistance) continue;
    if (!best || distance < best.distance) {
      best = { hold, distance, inside: distance === 0, index };
    }
  }
  return best;
}

/**
 * Nearest hold for each of several landmarks.
 *
 * @param {Record<string, {x, y}>} landmarks pixel-space, keyed by landmark name
 * @param {string[]} names which landmarks to match, e.g. the four contact points
 * @returns {Record<string, ReturnType<typeof nearestHold>>}
 */
export function nearestHoldsFor(landmarks, names, holds, width, height, options = {}) {
  const out = {};
  for (const name of names) {
    out[name] = nearestHold(landmarks?.[name], holds, width, height, options);
  }
  return out;
}

/**
 * The landmarks that actually touch holds.
 *
 * `*_index` is the fingertip/toe rather than the wrist or heel, so it sits much
 * closer to the hold the climber is actually on. These only exist because of
 * the 33-landmark widening; the 15-landmark format had no fingertip or toe.
 */
export const CONTACT_LANDMARKS = [
  'left_index',
  'right_index',
  'left_foot_index',
  'right_foot_index',
];
