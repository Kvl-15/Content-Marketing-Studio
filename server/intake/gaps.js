// @ts-check
/**
 * @module server/intake/gaps
 * Gap analysis for EventSpec (KB 7.3, 7.4).
 * Pure function: no network, no Date.now, no Math.random.
 */

/**
 * Validates whether a string is a real calendar date (YYYY-MM-DD).
 * Handles days in each month including leap years. Pure and deterministic.
 *
 * @param {any} str
 * @returns {boolean}
 */
export function isValidCalendarDate(str) {
  if (typeof str !== "string") return false;
  const match = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;

  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return day >= 1 && day <= daysInMonth[month - 1];
}

/**
 * Checks whether a provenance field is considered provided and valid.
 * Rule: Values with status "suggestion" or unconfirmed source "suggestion"
 * NEVER count as provided. Declined fields are not gaps.
 *
 * @param {any} field
 * @param {(val: any) => boolean} [validator]
 * @returns {{ provided: boolean; declined: boolean; reason?: string }}
 */
function checkProvenanceField(field, validator) {
  if (!field || typeof field !== "object") {
    return { provided: false, declined: false, reason: "missing" };
  }

  if (field.status === "declined") {
    return { provided: false, declined: true };
  }

  // Values with status "suggestion" never count as provided (D-13)
  if (field.status === "suggestion") {
    return { provided: false, declined: false, reason: "unconfirmed_suggestion" };
  }

  if (field.source === "suggestion" && !field.confirmed) {
    return { provided: false, declined: false, reason: "unconfirmed_suggestion" };
  }

  if (field.status !== "provided" && field.status !== "defaulted") {
    return { provided: false, declined: false, reason: "not_provided" };
  }

  if (field.value === null || field.value === undefined) {
    return { provided: false, declined: false, reason: "empty_value" };
  }

  if (validator && !validator(field.value)) {
    return { provided: false, declined: false, reason: "invalid_value" };
  }

  return { provided: true, declined: false };
}

/**
 * Performs gap analysis on an EventSpec per KB 7.3.
 * Categorises paths into 4 groups:
 * 1. Required, no default (must ask)
 * 2. Has a default (pre-fill and show for confirmation)
 * 3. Optional (ask once, user may skip)
 * 4. Derived (system computes, user may override)
 *
 * @param {any} spec
 * @returns {{
 *   required: Array<{ path: string; label: string; reason: string }>;
 *   defaulted: Array<{ path: string; label: string; value: any }>;
 *   optional: Array<{ path: string; label: string; reason: string }>;
 *   derived: Array<{ path: string; label: string; reason: string; value?: any }>;
 *   hasRequiredGaps: boolean;
 * }}
 */
export function findGaps(spec) {
  const required = [];
  const defaulted = [];
  const optional = [];
  const derived = [];

  if (!spec || typeof spec !== "object") {
    return {
      required: [{ path: "spec", label: "Event Specification", reason: "missing_spec" }],
      defaulted: [],
      optional: [],
      derived: [],
      hasRequiredGaps: true,
    };
  }

  // ── 1. REQUIRED, NO DEFAULT ──────────────────────────────────────────

  // designType: must be "id-card"
  if (spec.designType !== "id-card") {
    required.push({
      path: "designType",
      label: "Design Type",
      reason: spec.designType ? "unsupported_design_type" : "missing",
    });
  }

  // event.name: string min length 1
  const nameCheck = checkProvenanceField(
    spec.event?.name,
    (v) => typeof v === "string" && v.trim().length > 0
  );
  if (!nameCheck.provided && !nameCheck.declined) {
    required.push({
      path: "event.name",
      label: "Event Name",
      reason: nameCheck.reason || "missing",
    });
  }

  // event.venue: string min length 1
  const venueCheck = checkProvenanceField(
    spec.event?.venue,
    (v) => typeof v === "string" && v.trim().length > 0
  );
  if (!venueCheck.provided && !venueCheck.declined) {
    required.push({
      path: "event.venue",
      label: "Venue",
      reason: venueCheck.reason || "missing",
    });
  }

  // event.dates: array of valid calendar dates
  const datesCheck = checkProvenanceField(
    spec.event?.dates,
    (v) => Array.isArray(v) && v.length > 0 && v.every(isValidCalendarDate)
  );
  if (!datesCheck.provided && !datesCheck.declined) {
    required.push({
      path: "event.dates",
      label: "Event Dates",
      reason: datesCheck.reason || "missing",
    });
  }

  // roles: must have at least 1 role
  if (!Array.isArray(spec.roles) || spec.roles.length === 0) {
    required.push({
      path: "roles",
      label: "Attendee Roles",
      reason: "missing_roles",
    });
  } else {
    // Check individual roles for missing labels
    spec.roles.forEach((r, idx) => {
      if (!r || typeof r.label !== "string" || r.label.trim().length === 0) {
        required.push({
          path: `roles[${idx}].label`,
          label: `Role #${idx + 1} Label`,
          reason: "missing_role_label",
        });
      }
    });
  }

  // fields: provenance array of strings
  const fieldsCheck = checkProvenanceField(
    spec.fields,
    (v) => Array.isArray(v) && v.length > 0 && v.every((f) => typeof f === "string")
  );
  if (!fieldsCheck.provided && !fieldsCheck.declined) {
    required.push({
      path: "fields",
      label: "Card Fields",
      reason: fieldsCheck.reason || "missing",
    });
  }

  // ── 2. HAS A DEFAULT ──────────────────────────────────────────────────
  defaulted.push({
    path: "card.size",
    label: "Card Dimensions",
    value: `${spec.card?.widthMm ?? 54} × ${spec.card?.heightMm ?? 85.6} mm (CR80)`,
  });
  defaulted.push({
    path: "card.bleedMm",
    label: "Print Bleed",
    value: `${spec.card?.bleedMm ?? 3} mm`,
  });
  defaulted.push({
    path: "card.safeMarginMm",
    label: "Safe Margin",
    value: `${spec.card?.safeMarginMm ?? 3} mm`,
  });
  defaulted.push({
    path: "card.orientation",
    label: "Orientation",
    value: spec.card?.orientation ?? "portrait",
  });
  defaulted.push({
    path: "card.sides",
    label: "Sides",
    value: spec.card?.sides ?? "front",
  });

  // ── 3. OPTIONAL ──────────────────────────────────────────────────────
  const taglineCheck = checkProvenanceField(
    spec.event?.tagline,
    (v) => typeof v === "string" && v.trim().length > 0
  );
  if (!taglineCheck.provided && !taglineCheck.declined) {
    optional.push({
      path: "event.tagline",
      label: "Tagline / Subtitle",
      reason: taglineCheck.reason || "not_provided",
    });
  }

  if (!spec.event?.palette || !Array.isArray(spec.event.palette) || spec.event.palette.length === 0) {
    optional.push({
      path: "event.palette",
      label: "Event Color Palette",
      reason: "not_provided",
    });
  }

  // ── 4. DERIVED ────────────────────────────────────────────────────────
  if (Array.isArray(spec.roles)) {
    spec.roles.forEach((r, idx) => {
      if (!r.id || typeof r.id !== "string" || r.id.trim() === "") {
        derived.push({
          path: `roles[${idx}].id`,
          label: `Role ID for "${r.label || idx}"`,
          reason: "derive_slug",
        });
      }
      const colorCheck = checkProvenanceField(
        r.color,
        (c) => typeof c === "string" && /^#[0-9A-Fa-f]{6}$/.test(c)
      );
      if (!colorCheck.provided) {
        derived.push({
          path: `roles[${idx}].color`,
          label: `Color for role "${r.label || idx}"`,
          reason: "derive_lightness_spaced_color",
          value: r.color?.value || null,
        });
      }
    });
  }

  return {
    required,
    defaulted,
    optional,
    derived,
    hasRequiredGaps: required.length > 0,
  };
}
