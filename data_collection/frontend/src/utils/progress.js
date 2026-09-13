/**
 * The three numbers in the "Path to Done" header strip.
 *
 * Pure, and in its own module so the test can drive it with plain objects and
 * so ProgressStrip.jsx exports only a component (which is what React Fast
 * Refresh needs).
 */

/**
 * Count defined / labeled / tagged moves.
 *
 * - defined: moves that exist at all.
 * - labeled: moves carrying their strategy lens. Every move created through
 *   MoveForm is fully labeled on creation, so in practice this tracks defined.
 *   It stays a separate count because a move can be created while its
 *   environment or outcome POST fails, and because moves loaded from the server
 *   may predate the current shape.
 * - tagged: moves with at least one sensation frame tag. The server's
 *   `tag_count` wins when present; otherwise the move open right now is counted
 *   from the tags currently in the store.
 *
 * @param {Array} moves
 * @param {Array} frameTags - tags for the move open in tagging mode
 * @param {object|null} currentMove
 * @returns {{defined:number, labeled:number, tagged:number}}
 */
export function progressCounts(moves = [], frameTags = [], currentMove = null) {
  const list = Array.isArray(moves) ? moves.filter(Boolean) : [];

  const defined = list.length;
  const labeled = list.filter((m) => m.approach && m.size && m.labeled !== false).length;

  const tagged = list.filter((m) => {
    if (typeof m.tag_count === 'number') return m.tag_count > 0;
    if (currentMove && m.id === currentMove.id) return (frameTags || []).length > 0;
    return Boolean(m.has_tags);
  }).length;

  return { defined, labeled, tagged };
}
