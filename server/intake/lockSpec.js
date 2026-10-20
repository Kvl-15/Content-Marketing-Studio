// @ts-check
/**
 * @module server/intake/lockSpec
 * Validates and locks an EventSpec into an immutable spec (KB 7.6, D-13).
 * Pure function: no network, no Date.now, no Math.random.
 */

import { EventSpec } from "../../core/schemas.js";
import { findGaps } from "./gaps.js";

/**
 * Deep freezes an object recursively to guarantee immutability.
 *
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function deepFreeze(obj) {
  if (!obj || typeof obj !== "object" || Object.isFrozen(obj)) {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    // @ts-ignore
    deepFreeze(obj[key]);
  }
  return obj;
}

/**
 * Validates the full EventSpec and returns it locked (immutable),
 * or returns a typed error if required gaps or unconfirmed suggestions remain.
 *
 * @param {any} spec
 * @returns {{
 *   ok: true;
 *   spec: import("../../core/schemas.js").EventSpec;
 * } | {
 *   ok: false;
 *   error: {
 *     code: "SPEC_HAS_GAPS" | "UNCONFIRMED_SUGGESTION" | "INVALID_EVENT_SPEC" | "INVALID_SPEC";
 *     message: string;
 *     gaps?: any[];
 *     issues?: any[];
 *   };
 * }}
 */
export function lockSpec(spec) {
  if (!spec || typeof spec !== "object") {
    return {
      ok: false,
      error: {
        code: "INVALID_SPEC",
        message: "Spec must be a non-null object.",
      },
    };
  }

  // 1. Check for required gaps (KB 7.3, 7.6)
  const gaps = findGaps(spec);
  if (gaps.hasRequiredGaps) {
    return {
      ok: false,
      error: {
        code: "SPEC_HAS_GAPS",
        message: `Cannot lock spec: ${gaps.required.length} required field(s) are missing.`,
        gaps: gaps.required,
      },
    };
  }

  // 2. Values with status "suggestion" or unconfirmed source "suggestion" never count as provided (D-13)
  const provenanceFields = [
    { path: "event.name", field: spec.event?.name },
    { path: "event.tagline", field: spec.event?.tagline },
    { path: "event.venue", field: spec.event?.venue },
    { path: "event.dates", field: spec.event?.dates },
    { path: "fields", field: spec.fields },
  ];

  if (Array.isArray(spec.roles)) {
    spec.roles.forEach((r, idx) => {
      provenanceFields.push({ path: `roles[${idx}].color`, field: r?.color });
    });
  }

  for (const { path, field } of provenanceFields) {
    if (!field || typeof field !== "object") continue;

    if (field.status === "suggestion") {
      return {
        ok: false,
        error: {
          code: "UNCONFIRMED_SUGGESTION",
          message: `Field "${path}" has status "suggestion" and must be confirmed before locking.`,
        },
      };
    }

    if (field.source === "suggestion" && !field.confirmed) {
      return {
        ok: false,
        error: {
          code: "UNCONFIRMED_SUGGESTION",
          message: `Field "${path}" was suggested by AI and must be confirmed before locking.`,
        },
      };
    }
  }

  // 3. Schema validation with Zod EventSpec (KB 7.6)
  const parseResult = EventSpec.safeParse(spec);
  if (!parseResult.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_EVENT_SPEC",
        message: "Spec does not satisfy the EventSpec schema.",
        issues: parseResult.error.issues,
      },
    };
  }

  // Deep clone and freeze
  const cloned = JSON.parse(JSON.stringify(parseResult.data));
  const locked = deepFreeze(cloned);

  return {
    ok: true,
    spec: locked,
  };
}
