// @ts-check

/**
 * Expand an HTTPS-only check-in pattern.  Encoding happens before URL
 * validation so IDs can safely contain slashes, spaces, or query characters.
 * @param {string|number} id
 * @param {string} urlPattern
 */
export function buildCheckinUrl(id, urlPattern) {
  // Keep the temporary reversed call form source-compatible for early callers.
  if (typeof id === "string" && typeof urlPattern === "string" && id.includes("{id}") && !urlPattern.includes("{id}")) {
    [id, urlPattern] = [urlPattern, id];
  }
  if (typeof urlPattern !== "string" || !urlPattern.includes("{id}")) {
    throw new TypeError("check-in URL pattern must contain {id}");
  }
  const value = String(id);
  if (!value) throw new TypeError("check-in ID must not be empty");
  const expanded = urlPattern.replaceAll("{id}", encodeURIComponent(value));
  let url;
  try { url = new URL(expanded); }
  catch { throw new TypeError("check-in URL must be a valid HTTPS URL"); }
  if (url.protocol !== "https:") throw new TypeError("check-in URL must use HTTPS");
  return url.toString();
}
