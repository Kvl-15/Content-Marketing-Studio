// @ts-check

/**
 * Windows reserved device names (must be checked case-insensitively).
 * On Windows, CON.svg or NUL.png access the system devices!
 */
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

/**
 * Sanitises a string into a safe filename base component.
 *
 * Rules:
 * - NO fallback to person.name or email (Privacy rule D-10).
 * - Slashes ('/' and '\') replaced with '-'.
 * - Whitespace replaced with '-'.
 * - Path traversal ('..') removed.
 * - Windows forbidden characters (< > : " | ? *) removed.
 * - ASCII control characters (\x00-\x1F, \x7F) removed.
 * - Trailing dots and spaces stripped.
 * - Consecutive hyphens collapsed.
 * - Capped at 64 characters.
 * - If empty, returns "card".
 *
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeBaseName(raw) {
  if (typeof raw !== "string") {
    return "card";
  }

  let cleaned = raw
    // Replace slashes with hyphens
    .replace(/[/\\]+/g, "-")
    // Replace whitespace with hyphens
    .replace(/\s+/g, "-")
    // Remove path traversal '..'
    .replace(/\.{2,}/g, "")
    // Remove Windows reserved characters: < > : " | ? *
    .replace(/[<>:"|?*]/g, "")
    // Remove ASCII control characters
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, "")
    // Collapse consecutive hyphens
    .replace(/-+/g, "-")
    // Strip leading/trailing dots and hyphens
    .replace(/^[-.]+|[-.]+$/g, "");

  // Cap at 64 characters
  if (cleaned.length > 64) {
    cleaned = cleaned.slice(0, 64).replace(/[-.]+$/, "");
  }

  return cleaned || "card";
}

/**
 * Generates a safe, privacy-preserving filename for a person's card.
 *
 * Requirements:
 * - Strictly uses person.id. NO fallback to person.name or email.
 * - If id is missing or empty after sanitising, uses "card" (or "card-<index>").
 * - Guards against Windows reserved device names (CON, PRN, etc.) with extensions.
 * - Appends index if provided (e.g. index 2 -> "-2").
 *
 * @param {{ id?: string } | null | undefined} person
 * @param {string} format - e.g. "svg", "png"
 * @param {number | string} [index] - Optional collision/index suffix
 * @returns {string} Safe filename (e.g. "p-001.svg", "card-CON.png", "card-2.svg")
 */
export function fileNameFor(person, format, index) {
  const rawId = person && typeof person.id === "string" ? person.id : "";
  let base = sanitizeBaseName(rawId);

  // If index is provided, append it deterministically
  if (index !== undefined && index !== null && String(index).trim() !== "") {
    base = `${base}-${index}`;
  }

  // Check reserved Windows device names case-insensitively
  if (WINDOWS_RESERVED_NAMES.has(base.toLowerCase())) {
    base = `card-${base}`;
  }

  // Normalise extension
  const cleanExt = (format || "svg").toLowerCase().replace(/^\./, "");
  return `${base}.${cleanExt}`;
}

/**
 * Generates unique filenames for a batch of people, resolving collisions
 * deterministically with -2, -3 suffix (treated case-insensitively).
 *
 * @param {Array<{ id?: string }>} people
 * @param {string} format
 * @returns {string[]} Array of unique filenames matching people order
 */
export function uniqueFileNames(people, format) {
  if (!Array.isArray(people)) {
    return [];
  }

  /** @type {Set<string>} Lowercase set of already registered filenames */
  const registered = new Set();
  /** @type {string[]} */
  const results = [];

  for (const person of people) {
    let candidate = fileNameFor(person, format);
    let collisionIndex = 2;

    while (registered.has(candidate.toLowerCase())) {
      candidate = fileNameFor(person, format, collisionIndex);
      collisionIndex++;
    }

    registered.add(candidate.toLowerCase());
    results.push(candidate);
  }

  return results;
}
