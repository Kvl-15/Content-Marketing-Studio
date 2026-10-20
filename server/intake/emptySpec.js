// @ts-check
/**
 * @module server/intake/emptySpec
 * Creates an empty EventSpec scaffold with provenance tracking (KB 7.1, 7.3).
 * Pure function: no network, no Date.now, no Math.random.
 */

/**
 * Creates an initial EventSpec with "unknown" provenance for required fields
 * and standardized card/QR defaults.
 *
 * @param {string | null | undefined} [designType]
 * @returns {import("../../core/schemas.js").EventSpec}
 */
export function emptySpec(designType = "id-card") {
  const normalizedType = designType === "id-card" ? "id-card" : null;

  return {
    schemaVersion: 1,
    // @ts-ignore - allow null in uncompleted intake draft; validated at lockSpec
    designType: normalizedType,
    event: {
      name: { value: null, status: "unknown" },
      tagline: { value: null, status: "unknown" },
      venue: { value: null, status: "unknown" },
      dates: { value: null, status: "unknown" },
      palette: undefined,
    },
    roles: [],
    fields: { value: null, status: "unknown" },
    card: {
      widthMm: 54,
      heightMm: 85.6,
      orientation: "portrait",
      bleedMm: 3,
      safeMarginMm: 3,
      sides: "front",
    },
    qr: {
      enabled: false,
      urlPattern: "",
    },
  };
}
