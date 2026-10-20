// @ts-check
/**
 * @module server/intake/applyAnswer
 * Immutably applies user answers to an EventSpec (KB 7.4, 7.5, D-13, D-39).
 * Pure function: no network, no Date.now, no Math.random.
 */

import { isValidCalendarDate } from "./gaps.js";

/**
 * Calculates HSL lightness (0-100) from a Hex color string (#RRGGBB).
 *
 * @param {string} hex
 * @returns {number}
 */
export function hexLightness(hex) {
  if (typeof hex !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return 0;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return Math.round(((max + min) / 2) * 100);
}

/**
 * Converts HSL to uppercase Hex color string.
 *
 * @param {number} h - Hue (0..360)
 * @param {number} s - Saturation (0..100)
 * @param {number} l - Lightness (0..100)
 * @returns {string}
 */
export function hslToHex(h, s, l) {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (/** @type {number} */ n) => {
    const k = (n + h / 30) % 12;
    const color = lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

/**
 * Curated sequence of hues and lightnesses for default role colors.
 * Lightnesses for adjacent roles differ by at least 19% (exceeding the >= 15% rule).
 */
const DEFAULT_ROLE_PALETTE = [
  { h: 220, s: 70, l: 22 }, // Dark Navy (L: ~22%)
  { h: 160, s: 75, l: 42 }, // Emerald Teal (L: ~42%) -> diff: 20%
  { h: 38, s: 85, l: 62 },  // Warm Amber (L: ~62%)  -> diff: 20%
  { h: 280, s: 80, l: 82 }, // Lavender (L: ~82%)    -> diff: 20%
  { h: 345, s: 70, l: 30 }, // Rich Crimson (L: ~30%)-> diff: 52%
  { h: 200, s: 75, l: 50 }, // Sky Cerulean (L: ~50%)-> diff: 20%
  { h: 90, s: 70, l: 70 },  // Soft Lime (L: ~70%)   -> diff: 20%
];

/**
 * Generates a default color for a role index ensuring >= 15% lightness difference
 * from adjacent roles.
 *
 * @param {number} index
 * @returns {string}
 */
export function defaultRoleColor(index) {
  const step = DEFAULT_ROLE_PALETTE[index % DEFAULT_ROLE_PALETTE.length];
  return hslToHex(step.h, step.s, step.l);
}

/**
 * Converts a string into a lowercase URL/ID slug.
 *
 * @param {string} str
 * @returns {string}
 */
export function slugify(str) {
  if (typeof str !== "string") return "";
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Applies a single answer or a batch of answers immutably to an EventSpec.
 * Never mutates the input spec.
 *
 * @param {any} spec - Current EventSpec (immutable input)
 * @param {{
 *   path?: string;
 *   value?: any;
 *   declined?: boolean;
 *   answers?: Array<{ path: string; value?: any; declined?: boolean }>;
 * }} answerInput
 * @returns {{ ok: true; spec: any } | { ok: false; error: { code: string; message: string; path?: string } }}
 */
export function applyAnswer(spec, answerInput) {
  if (!spec || typeof spec !== "object") {
    return {
      ok: false,
      error: { code: "INVALID_SPEC", message: "Input spec must be a valid object." },
    };
  }

  if (!answerInput || typeof answerInput !== "object") {
    return {
      ok: false,
      error: { code: "INVALID_ANSWER", message: "Answer input must be an object." },
    };
  }

  // Clone spec deeply to guarantee input immutability
  const draft = JSON.parse(JSON.stringify(spec));

  // Determine list of answers to apply
  const answersList = Array.isArray(answerInput.answers)
    ? answerInput.answers
    : [
        {
          path: answerInput.path,
          value: answerInput.value,
          declined: answerInput.declined,
          action: answerInput.action,
        },
      ];

  for (const item of answersList) {
    const { path, value } = item;
    const action = item.action || (item.declined === true ? "decline" : undefined);

    if (!path || typeof path !== "string") {
      return {
        ok: false,
        error: { code: "INVALID_ANSWER_PATH", message: "Each answer must specify a path string." },
      };
    }

    // ── Check action: "confirm" ──────────────────────────────────────────
    if (action === "confirm") {
      if (path === "event.name") {
        if (!draft.event?.name || draft.event.name.value === null) {
          return {
            ok: false,
            error: {
              code: "CANNOT_CONFIRM_EMPTY",
              message: `Cannot confirm field "${path}" because it has no value.`,
              path,
            },
          };
        }
        draft.event.name.confirmed = true;
        continue;
      }
      if (path === "event.venue") {
        if (!draft.event?.venue || draft.event.venue.value === null) {
          return {
            ok: false,
            error: {
              code: "CANNOT_CONFIRM_EMPTY",
              message: `Cannot confirm field "${path}" because it has no value.`,
              path,
            },
          };
        }
        draft.event.venue.confirmed = true;
        continue;
      }
      if (path === "event.dates") {
        if (
          !draft.event?.dates ||
          !Array.isArray(draft.event.dates.value) ||
          draft.event.dates.value.length === 0
        ) {
          return {
            ok: false,
            error: {
              code: "CANNOT_CONFIRM_EMPTY",
              message: `Cannot confirm field "${path}" because it has no dates.`,
              path,
            },
          };
        }
        draft.event.dates.confirmed = true;
        continue;
      }
      if (path === "event.tagline") {
        if (!draft.event?.tagline || draft.event.tagline.value === null) {
          return {
            ok: false,
            error: {
              code: "CANNOT_CONFIRM_EMPTY",
              message: `Cannot confirm field "${path}" because it has no value.`,
              path,
            },
          };
        }
        draft.event.tagline.confirmed = true;
        continue;
      }
      if (path === "fields") {
        if (
          !draft.fields ||
          !Array.isArray(draft.fields.value) ||
          draft.fields.value.length === 0
        ) {
          return {
            ok: false,
            error: {
              code: "CANNOT_CONFIRM_EMPTY",
              message: `Cannot confirm field "${path}" because it has no values.`,
              path,
            },
          };
        }
        draft.fields.confirmed = true;
        continue;
      }
      if (path === "roles") {
        if (!Array.isArray(draft.roles) || draft.roles.length === 0) {
          return {
            ok: false,
            error: {
              code: "CANNOT_CONFIRM_EMPTY",
              message: `Cannot confirm field "${path}" because no roles exist.`,
              path,
            },
          };
        }
        draft.roles.forEach((r) => {
          if (r.color) r.color.confirmed = true;
        });
        continue;
      }
      const roleColorMatch = path.match(/^roles\[(\d+)\]\.color$/);
      if (roleColorMatch) {
        const idx = parseInt(roleColorMatch[1], 10);
        if (!draft.roles?.[idx]?.color) {
          return {
            ok: false,
            error: {
              code: "CANNOT_CONFIRM_EMPTY",
              message: `Cannot confirm color for role at index ${idx}.`,
              path,
            },
          };
        }
        draft.roles[idx].color.confirmed = true;
        continue;
      }
    }

    // ── Check declined requests (action === "decline") ───────────────────
    if (action === "decline" || item.declined === true) {
      if (
        path === "designType" ||
        path === "event.name" ||
        path === "event.venue" ||
        path === "event.dates" ||
        path === "roles" ||
        path === "fields"
      ) {
        return {
          ok: false,
          error: {
            code: "CANNOT_DECLINE_REQUIRED",
            message: `Field "${path}" is required and cannot be declined.`,
            path,
          },
        };
      }

      if (path === "event.tagline") {
        draft.event = draft.event || {};
        draft.event.tagline = {
          value: null,
          status: "declined",
          source: "answer",
          confirmed: true,
        };
        continue;
      }

      if (path === "event.palette") {
        draft.event = draft.event || {};
        draft.event.palette = undefined;
        continue;
      }
    }

    // ── D-39 Guardrails: no landscape, back sides or QR toggle ──────────
    if (path === "card.orientation" && value !== "portrait") {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_CONFIGURATION",
          message: "Landscape orientation is not supported (D-39).",
          path,
        },
      };
    }
    if (path === "card.sides" && value !== "front") {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_CONFIGURATION",
          message: "Back sides are not supported (D-39).",
          path,
        },
      };
    }
    if (path === "qr.enabled" && value === true) {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_CONFIGURATION",
          message: "QR code toggle is deferred and not supported (D-39).",
          path,
        },
      };
    }

    // ── Apply field values ──────────────────────────────────────────────
    if (path === "designType") {
      if (value !== "id-card") {
        return {
          ok: false,
          error: {
            code: "UNSUPPORTED_DESIGN_TYPE",
            message: 'Only "id-card" design type is supported.',
            path,
          },
        };
      }
      draft.designType = "id-card";
    } else if (path === "event.name") {
      if (typeof value !== "string" || value.trim().length === 0) {
        return {
          ok: false,
          error: {
            code: "INVALID_FIELD_VALUE",
            message: "Event name must be a non-empty string.",
            path,
          },
        };
      }
      draft.event = draft.event || {};
      draft.event.name = {
        value: value.trim(),
        status: "provided",
        source: "answer",
        confirmed: true,
      };
    } else if (path === "event.venue") {
      if (typeof value !== "string" || value.trim().length === 0) {
        return {
          ok: false,
          error: {
            code: "INVALID_FIELD_VALUE",
            message: "Venue must be a non-empty string.",
            path,
          },
        };
      }
      draft.event = draft.event || {};
      draft.event.venue = {
        value: value.trim(),
        status: "provided",
        source: "answer",
        confirmed: true,
      };
    } else if (path === "event.dates") {
      const datesArray = Array.isArray(value) ? value : [value];
      if (datesArray.length === 0) {
        return {
          ok: false,
          error: {
            code: "INVALID_FIELD_VALUE",
            message: "At least one date is required.",
            path,
          },
        };
      }
      for (const d of datesArray) {
        if (!isValidCalendarDate(d)) {
          return {
            ok: false,
            error: {
              code: "INVALID_CALENDAR_DATE",
              message: `"${d}" is not a valid calendar date (expected YYYY-MM-DD).`,
              path,
            },
          };
        }
      }
      draft.event = draft.event || {};
      draft.event.dates = {
        value: datesArray.map((d) => d.trim()),
        status: "provided",
        source: "answer",
        confirmed: true,
      };
    } else if (path === "roles") {
      if (!Array.isArray(value) || value.length === 0) {
        return {
          ok: false,
          error: {
            code: "INVALID_FIELD_VALUE",
            message: "At least one attendee role must be provided.",
            path,
          },
        };
      }

      const formattedRoles = [];
      for (let i = 0; i < value.length; i++) {
        const itemRole = value[i];
        const rawLabel = typeof itemRole === "string" ? itemRole : itemRole?.label || "";
        const label = rawLabel.trim();
        if (!label) {
          return {
            ok: false,
            error: {
              code: "INVALID_ROLE_LABEL",
              message: `Role at index ${i} has an empty label.`,
              path: `roles[${i}]`,
            },
          };
        }

        const rawId = typeof itemRole === "object" && itemRole?.id ? itemRole.id : label;
        const id = slugify(rawId);
        if (!id) {
          return {
            ok: false,
            error: {
              code: "INVALID_ROLE_ID",
              message: `Could not generate a valid lowercase slug ID for role "${label}".`,
              path: `roles[${i}]`,
            },
          };
        }

        const expectedCount =
          typeof itemRole === "object" && typeof itemRole.expectedCount === "number"
            ? Math.max(0, Math.floor(itemRole.expectedCount))
            : 0;

        // Role color
        let colorHex =
          typeof itemRole === "object" && itemRole.color
            ? typeof itemRole.color === "string"
              ? itemRole.color
              : itemRole.color.value
            : null;

        if (colorHex && !/^#[0-9A-Fa-f]{6}$/.test(colorHex)) {
          return {
            ok: false,
            error: {
              code: "INVALID_ROLE_COLOR",
              message: `Role color "${colorHex}" is not a valid 6-digit hex string.`,
              path: `roles[${i}].color`,
            },
          };
        }

        // If no color provided, derive default color with >= 15% lightness difference
        const isDerived = !colorHex;
        if (!colorHex) {
          colorHex = defaultRoleColor(i);
        }

        formattedRoles.push({
          id,
          label,
          expectedCount,
          color: {
            value: colorHex,
            status: isDerived ? "defaulted" : "provided",
            source: isDerived ? "default" : "answer",
            confirmed: true,
          },
        });
      }

      draft.roles = formattedRoles;
    } else if (path === "fields") {
      if (!Array.isArray(value) || value.length === 0) {
        return {
          ok: false,
          error: {
            code: "INVALID_FIELD_VALUE",
            message: "Fields must be a non-empty array of strings.",
            path,
          },
        };
      }
      const stringFields = value.filter((f) => typeof f === "string" && f.trim().length > 0);
      if (stringFields.length === 0) {
        return {
          ok: false,
          error: {
            code: "INVALID_FIELD_VALUE",
            message: "Fields must contain valid string identifiers.",
            path,
          },
        };
      }
      draft.fields = {
        value: stringFields,
        status: "provided",
        source: "answer",
        confirmed: true,
      };
    } else if (path === "event.tagline") {
      if (value === null || value === undefined || value === "") {
        draft.event = draft.event || {};
        draft.event.tagline = {
          value: null,
          status: "declined",
          source: "answer",
          confirmed: true,
        };
      } else {
        draft.event = draft.event || {};
        draft.event.tagline = {
          value: String(value).trim(),
          status: "provided",
          source: "answer",
          confirmed: true,
        };
      }
    } else if (path === "event.palette") {
      if (!value) {
        draft.event = draft.event || {};
        draft.event.palette = undefined;
      } else {
        const pal = Array.isArray(value) ? value : [value];
        if (pal.length < 1 || pal.length > 3) {
          return {
            ok: false,
            error: {
              code: "INVALID_PALETTE",
              message: "Event palette must contain 1 to 3 hex colors.",
              path,
            },
          };
        }
        for (const col of pal) {
          if (typeof col !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(col)) {
            return {
              ok: false,
              error: {
                code: "INVALID_PALETTE",
                message: `Palette color "${col}" is not a valid 6-digit hex color.`,
                path,
              },
            };
          }
        }
        draft.event = draft.event || {};
        draft.event.palette = pal;
      }
    } else {
      return {
        ok: false,
        error: {
          code: "UNKNOWN_FIELD_PATH",
          message: `Path "${path}" is not a recognised intake field.`,
          path,
        },
      };
    }
  }

  return { ok: true, spec: draft };
}
