/**
 * Reading the taxonomy out of /api/config.
 *
 * Three things every option needs and none of the components should reinvent:
 * the label to show, the definition behind the "i", and a fallback for values
 * the config has no entry for.
 *
 * `display_label` (step 8) lets wording change server-side without touching a
 * stored enum value — `reached_not_controlled` can read "Reached it — not in
 * control" without a migration.
 */

/** `horizontal_edge` → `Horizontal Edge`. The fallback when config says nothing. */
export function formatLabel(value) {
  if (!value) return '';
  return String(value)
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** The definition entry for one option, or an empty object. */
export function optionEntry(config, taxonomyKey, value) {
  return config?.definitions?.[taxonomyKey]?.[value] ?? {};
}

/**
 * What to show for an option: the server's `display_label` when it has one,
 * otherwise the formatted value.
 */
export function optionLabel(config, taxonomyKey, value) {
  return optionEntry(config, taxonomyKey, value).display_label || formatLabel(value);
}

/** The plain-language definition for an option, or null when there is none. */
export function optionDescription(config, taxonomyKey, value) {
  return optionEntry(config, taxonomyKey, value).description || null;
}
