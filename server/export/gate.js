// @ts-check

/**
 * @typedef {import("../../core/schemas.js").Issue} Issue
 */

/**
 * Gate check enforcing Rule D-09: cards with validation errors cannot be exported.
 *
 * Rules:
 * - Fails closed: if issues is not an array, export is refused.
 * - Any issue with severity === "error" (e.g. UNKNOWN_ROLE_ID) REFUSES export.
 * - Any issue with severity === "warning" (e.g. OUTSIDE_SAFE_MARGIN, ELEMENT_DROPPED)
 *   REFUSES export unless acknowledgedWarnings is true.
 *
 * @param {unknown} issues - Validation issues array.
 * @param {{ acknowledgedWarnings?: boolean }} [options]
 * @returns {{
 *   ok: boolean;
 *   issues: any[];
 *   errors: any[];
 *   warnings: any[];
 *   reason: string | null;
 * }}
 */
export function checkExportGate(issues, options = {}) {
  const acknowledgedWarnings = options.acknowledgedWarnings ?? false;

  // Fail closed: issues must be an array
  if (!Array.isArray(issues)) {
    return {
      ok: false,
      issues: [],
      errors: [
        {
          severity: "error",
          code: "INVALID_ISSUES",
          message: "Validation issues input must be an array (fails closed)",
        },
      ],
      warnings: [],
      reason:
        "Export refused: validation issues must be an array (fails closed)",
    };
  }

  const errors = issues.filter((i) => i && i.severity === "error");
  const warnings = issues.filter((i) => i && i.severity === "warning");

  if (errors.length > 0) {
    const errorCodes = errors.map((e) => e.code || "ERROR").join(", ");
    return {
      ok: false,
      issues,
      errors,
      warnings,
      reason: `Export refused: card has ${errors.length} validation error(s) [${errorCodes}] (D-09)`,
    };
  }

  if (warnings.length > 0 && !acknowledgedWarnings) {
    const warningCodes = warnings.map((w) => w.code || "WARNING").join(", ");
    return {
      ok: false,
      issues,
      errors,
      warnings,
      reason: `Export refused: card has ${warnings.length} unacknowledged warning(s) [${warningCodes}] (D-09)`,
    };
  }

  return {
    ok: true,
    issues,
    errors: [],
    warnings,
    reason: null,
  };
}
