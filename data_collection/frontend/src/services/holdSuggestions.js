/**
 * Turn a pose frame plus the video's holds into labelling suggestions.
 *
 * This is the layer between the hold-matching primitives and the UI. It owns
 * only the *labelling* decisions — which limb maps to which body part, what
 * counts as "on" a hold — and delegates every coordinate decision to
 * holdMatching, which already handles the pixel→normalized conversion, the
 * fingertip/toe landmark set, and the unknown-frame-size case.
 *
 * Nothing here touches units. If a suggestion looks wrong in space, the bug is
 * in the inputs (a missing width/height, a bad bbox), not in this file.
 */
import { nearestHoldsFor, CONTACT_LANDMARKS } from './holdMatching.js';

/**
 * How close, in normalized units, a fingertip or toe must be to count as
 * touching. 0.04 is 4% of the frame's long edge — roughly a hold's own width,
 * which tolerates landmark jitter without matching a limb halfway across the
 * wall. Anything inside the box (distance 0) always counts.
 */
export const CONTACT_THRESHOLD = 0.04;

/**
 * Contact landmark → how a labeller would describe it.
 *
 * `bodyPart` is drawn from the backend's BODY_PARTS taxonomy, which has no
 * fingertip or toe entries — the nearest real options are the wrist and ankle,
 * which is what a tag on this limb would use.
 */
export const CONTACT_META = {
  left_index: { label: 'Left hand', bodyPart: 'left_wrist', side: 'left', limb: 'hand' },
  right_index: { label: 'Right hand', bodyPart: 'right_wrist', side: 'right', limb: 'hand' },
  left_foot_index: { label: 'Left foot', bodyPart: 'left_ankle', side: 'left', limb: 'foot' },
  right_foot_index: { label: 'Right foot', bodyPart: 'right_ankle', side: 'right', limb: 'foot' },
};

/**
 * Pull one landmark's pixel coordinates out of a parsed CSV row.
 *
 * Row values are strings, and a frame with no detected pose has empty strings
 * in every landmark column, so both need filtering before any arithmetic.
 */
export function landmarkFromRow(row, name) {
  if (!row) return null;
  const x = numberOrNull(row[`landmark_${name}_x`]);
  const y = numberOrNull(row[`landmark_${name}_y`]);
  if (x === null || y === null) return null;

  return {
    x,
    y,
    visibility: numberOrNull(row[`landmark_${name}_visibility`]),
  };
}

/**
 * Parse a CSV cell, treating an absent value as absent.
 *
 * `Number('')` is `0` and `Number.isFinite(0)` is true, so parsing directly
 * would turn a pose-less frame's empty columns into a limb sitting at the
 * frame's top-left corner — and that phantom limb would then happily match any
 * hold near the origin.
 */
function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Every contact landmark in a row, keyed by name, in pixel space. */
export function contactLandmarksFromRow(row) {
  const out = {};
  for (const name of CONTACT_LANDMARKS) {
    const lm = landmarkFromRow(row, name);
    if (lm) out[name] = lm;
  }
  return out;
}

/**
 * Suggest which holds the climber is on at one frame.
 *
 * @param {object} row a parsed CSV row (pixel-space landmark columns)
 * @param {Array} holds the video's holds, normalized 0-1
 * @param {number} width intrinsic video width
 * @param {number} height intrinsic video height
 * @param {{threshold?: number, minVisibility?: number}} [options]
 * @returns {{
 *   available: boolean,
 *   reason: string|null,
 *   contacts: Array<{name, label, bodyPart, side, limb, holdIndex, hold, distance, inside}>
 * }}
 *   `available: false` with a `reason` whenever a suggestion cannot honestly be
 *   made — no holds, unknown frame size, no pose on this frame. The UI shows
 *   the reason rather than an empty list, so "nothing detected" is never
 *   confused with "not working".
 */
export function suggestHoldsForFrame(row, holds, width, height, options = {}) {
  const { threshold = CONTACT_THRESHOLD, minVisibility = 0.5 } = options;

  if (!holds?.length) {
    return { available: false, reason: 'no-holds', contacts: [] };
  }
  // Delegated to holdMatching, but checked here so the UI can explain itself.
  if (!(width > 0) || !(height > 0)) {
    return { available: false, reason: 'no-dimensions', contacts: [] };
  }

  const landmarks = contactLandmarksFromRow(row);
  if (Object.keys(landmarks).length === 0) {
    return { available: false, reason: 'no-pose', contacts: [] };
  }

  // Low-visibility limbs are usually occluded or off-frame; a confident
  // suggestion from one is worse than no suggestion.
  const visible = {};
  for (const [name, lm] of Object.entries(landmarks)) {
    if (lm.visibility === null || lm.visibility >= minVisibility) {
      visible[name] = lm;
    }
  }

  const matches = nearestHoldsFor(
    visible,
    CONTACT_LANDMARKS,
    holds,
    width,
    height,
    { maxDistance: threshold }
  );

  const contacts = [];
  for (const name of CONTACT_LANDMARKS) {
    const match = matches[name];
    if (!match) continue;
    contacts.push({
      name,
      ...CONTACT_META[name],
      holdIndex: match.index,
      hold: match.hold,
      distance: match.distance,
      inside: match.inside,
    });
  }

  if (contacts.length === 0) {
    return { available: false, reason: 'no-contact', contacts: [] };
  }

  // Surest first: inside the box beats near it.
  contacts.sort((a, b) => a.distance - b.distance);
  return { available: true, reason: null, contacts };
}

/** The body parts a set of contacts implies, deduplicated, for a frame tag. */
export function bodyPartsFor(contacts) {
  return [...new Set(contacts.map((c) => c.bodyPart))];
}

/**
 * The single side a set of contacts implies, or null when it is mixed.
 * A tag carries one side, so "both hands" cannot fill it in.
 */
export function sideFor(contacts) {
  const sides = new Set(contacts.map((c) => c.side));
  return sides.size === 1 ? [...sides][0] : null;
}
