// @ts-check
/**
 * @module core/picker
 */

/**
 * Selects 3 distinct drafts from a list of eligible looks.
 *
 * STUB: replace with real implementation
 *
 * @param {any[]} eligible
 * @param {string[]} [_hints]
 * @param {string[]} [_excludedGroups]
 * @returns {any[]}
 */
export function pickThree(eligible, _hints = [], _excludedGroups = []) {
  if (!Array.isArray(eligible)) return [];
  const unique = Array.from(new Set(eligible));
  return unique.slice(0, 3);
}
