// @ts-check
import { renderCard } from "./render.js";
import { stressSet } from "./stressSet.js";

/**
 * @module core/picker
 * Design picker, eligibility filtering, and stress evaluation (Spec 9.2, 9.3, 9.6, Part 15).
 * Core remains pure: no filesystem or network calls (D-06).
 */

/**
 * Attribute weights for pairwise distance calculation (Spec 9.2).
 */
export const WEIGHTS = Object.freeze({
  skeleton: 3,
  header: 2,
  marker: 2,
  theme: 2,
  photo: 1,
});

/**
 * Minimum required pairwise distance for distinct drafts (Spec 9.6).
 */
export const MIN_PAIR_DISTANCE = 5;

/**
 * Calculates distance between two looks based on Spec 9.2 attribute weights.
 *
 * @param {any} a - First look
 * @param {any} b - Second look
 * @returns {number}
 */
export function distance(a, b) {
  if (!a?.attributes || !b?.attributes) return 0;
  return Object.entries(WEIGHTS).reduce((sum, [key, weight]) => {
    return sum + (a.attributes[key] !== b.attributes[key] ? weight : 0);
  }, 0);
}

/**
 * Generates all k-sized combinations from an array.
 *
 * @template T
 * @param {T[]} arr
 * @param {number} k
 * @returns {T[][]}
 */
export function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (!Array.isArray(arr) || arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = getCombinations(rest, k - 1).map((combo) => [first, ...combo]);
  const withoutFirst = getCombinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

/**
 * Extracts a look ID from a string or look object.
 *
 * @param {any} look
 * @returns {string}
 */
export function getLookId(look) {
  if (typeof look === "string") return look;
  return look?.id || "";
}

/**
 * Canonical group key of sorted look IDs joined by comma.
 *
 * @param {any[]} group
 * @returns {string}
 */
export function groupKey(group) {
  return group.map(getLookId).sort().join(",");
}

/**
 * Scores a candidate triplet of looks (sum of 3 pair distances + hint bonus).
 *
 * @param {any[]} group - Triplet of looks
 * @param {string[]} [hints=[]] - AI/user style hints
 * @returns {number}
 */
export function scoreGroup(group, hints = []) {
  if (group.length < 3) return 0;
  const [a, b, c] = group;
  const pairDistances = distance(a, b) + distance(a, c) + distance(b, c);
  const hintBonus = 3 * group.filter((look) =>
    Array.isArray(look?.tags) && look.tags.some((tag) => hints.includes(tag))
  ).length;
  return pairDistances + hintBonus;
}

/**
 * Checks whether every pair in a triplet satisfies MIN_PAIR_DISTANCE (Spec 9.6).
 *
 * @param {any[]} group
 * @returns {boolean}
 */
export function meetsMinPairDistance(group) {
  if (group.length < 3) return true;
  const [a, b, c] = group;
  return (
    distance(a, b) >= MIN_PAIR_DISTANCE &&
    distance(a, c) >= MIN_PAIR_DISTANCE &&
    distance(b, c) >= MIN_PAIR_DISTANCE
  );
}

/**
 * Normalizes an excluded groups list into a Set of canonical group keys.
 *
 * @param {Array<string | string[]>} excludedGroups
 * @returns {Set<string>}
 */
function normalizeExcludedGroups(excludedGroups = []) {
  const set = new Set();
  for (const item of excludedGroups) {
    if (Array.isArray(item)) {
      set.add(item.map(getLookId).sort().join(","));
    } else if (typeof item === "string") {
      set.add(item.split(",").map((s) => s.trim()).sort().join(","));
    }
  }
  return set;
}

/**
 * Selects 3 distinct drafts from a list of eligible looks (Spec 9.2, 9.6).
 *
 * - Highest total of 3 pair distances plus 3 per look whose tags match any hint.
 * - Groups where every pair is >= MIN_PAIR_DISTANCE are preferred (Spec 9.6).
 * - Ties broken alphabetically by groupKey; deterministic.
 * - Fewer than 3 eligible: returns what exists (2 or 1), never throws.
 *
 * @param {any[]} eligible - Array of eligible looks
 * @param {string[]} [hints=[]] - Style hints
 * @param {Array<string | string[]>} [excludedGroups=[]] - Previously seen groups to exclude
 * @returns {any[]} Chosen triplet or available subset
 */
export function pickThree(eligible, hints = [], excludedGroups = []) {
  if (!Array.isArray(eligible) || eligible.length === 0) return [];
  if (eligible.length < 3) return eligible.slice();

  const excludedKeys = normalizeExcludedGroups(excludedGroups);
  const allCombinations = getCombinations(eligible, 3);
  const candidates = allCombinations.filter((g) => !excludedKeys.has(groupKey(g)));

  if (candidates.length === 0) {
    return [];
  }

  const sorted = [...candidates].sort((a, b) => {
    // 1. Spec 9.6 preference: groups where every pair >= MIN_PAIR_DISTANCE
    const aMeets = meetsMinPairDistance(a);
    const bMeets = meetsMinPairDistance(b);
    if (aMeets !== bMeets) {
      return aMeets ? -1 : 1;
    }

    // 2. Highest score
    const diff = scoreGroup(b, hints) - scoreGroup(a, hints);
    if (diff !== 0) return diff;

    // 3. Alphabetical tie-breaker by groupKey
    return groupKey(a).localeCompare(groupKey(b));
  });

  return sorted[0];
}

/**
 * Filters looks against event requirements and compatibility rules (Spec 9.3).
 *
 * @param {any[] | Record<string, any>} looks - Available looks
 * @param {Record<string, any>} spec - EventSpec or minimal event configuration
 * @param {Record<string, any>} [compat=null] - Compatibility rules (from compatibility.json)
 * @returns {{ eligible: any[], removed: Array<{ lookId: string, reason: string }> }}
 */
export function filterEligible(looks, spec, compat = null) {
  const lookList = Array.isArray(looks) ? looks : Object.values(looks || {});
  const eligible = [];
  const removed = [];

  const orientation = spec?.card?.orientation || "portrait";
  const roleCount = Array.isArray(spec?.roles)
    ? spec.roles.length
    : typeof spec?.roles === "number"
    ? spec.roles
    : 1;
  const photosAvailable =
    spec?.hasPhotos !== false &&
    spec?.photosExist !== false &&
    spec?.photos !== false;

  for (const look of lookList) {
    const lookName = look.id.replace(/^look\./, "");

    // 1. Orientation check
    if (
      Array.isArray(look.requires?.orientation) &&
      !look.requires.orientation.includes(orientation)
    ) {
      removed.push({
        lookId: look.id,
        reason: `${lookName} does not support ${orientation} orientation`,
      });
      continue;
    }

    // 2. Max roles check (check look.requires and compat overrides)
    const maxRoles = compat?.maxRolesLimits?.[look.id] ?? look.requires?.maxRoles;
    if (typeof maxRoles === "number" && roleCount > maxRoles) {
      removed.push({
        lookId: look.id,
        reason: `${lookName} supports at most ${maxRoles} roles`,
      });
      continue;
    }

    // 3. Needs photo slot check
    if (look.requires?.needsPhotoSlot && !photosAvailable) {
      removed.push({
        lookId: look.id,
        reason: `${lookName} requires participant photos`,
      });
      continue;
    }

    // 4. Compatibility rules (disallowedCombinations)
    if (compat?.disallowedCombinations) {
      let disallowedReason = null;
      for (const rule of compat.disallowedCombinations) {
        if (rule.skeleton && look.skeleton !== rule.skeleton) continue;
        if (rule.blocks) {
          const matches = Object.entries(rule.blocks).every(
            ([slot, blockId]) => look.blocks?.[slot] === blockId
          );
          if (matches) {
            disallowedReason = rule.reason || "Incompatible combination of skeleton and blocks";
            break;
          }
        }
      }
      if (disallowedReason) {
        removed.push({ lookId: look.id, reason: disallowedReason });
        continue;
      }
    }

    eligible.push(look);
  }

  return { eligible, removed };
}

/**
 * Creates the default stress test evaluator using renderCard on stressSet.
 *
 * @param {{
 *   font?: any,
 *   brand?: any,
 *   skeletons?: Record<string, any>,
 *   blocks?: Record<string, any>,
 *   themes?: Record<string, any>,
 *   stressSet?: any[],
 * }} [context={}]
 * @returns {(look: any, spec: any) => { ok: boolean, errors?: any[] }}
 */
export function createDefaultRunStress({
  font,
  brand,
  skeletons = {},
  blocks = {},
  themes = {},
  stressSet: customStressSet,
} = {}) {
  return function defaultRunStress(look, spec) {
    if (!font) {
      return { ok: true, errors: [] };
    }
    const skeleton = skeletons[look.skeleton];
    const theme = themes[look.theme];
    const errors = [];
    const specRoles = Array.isArray(spec?.roles) && spec.roles.length > 0
      ? spec.roles
      : (Array.isArray(spec?.event?.roles) && spec.event.roles.length > 0 ? spec.event.roles : []);

    let dataset = customStressSet;
    if (!dataset) {
      if (specRoles.length > 0) {
        const primaryRole = specRoles[0].id;
        const secondaryRole = specRoles[1]?.id || primaryRole;
        dataset = stressSet.map((person) => {
          if (specRoles.some((r) => r.id === person.roleId)) return person;
          const roleId = person.roleId === "organizer" ? secondaryRole : primaryRole;
          return { ...person, roleId };
        });
      } else {
        dataset = stressSet;
      }
    }

    for (const person of dataset) {
      const res = renderCard({
        person,
        event: spec,
        brand,
        card: spec?.card,
        font,
        skeleton,
        blocks,
        theme,
        look,
      });
      const cardErrors = (res.issues || []).filter((i) => i.severity === "error");
      if (cardErrors.length > 0) {
        errors.push(...cardErrors.map((i) => ({ ...i, source: "stress-set" })));
      }
    }
    return { ok: errors.length === 0, errors };
  };
}

/**
 * Evaluates whether a stress test result indicates a pass.
 *
 * @param {any} result
 * @returns {boolean}
 */
function isStressPassing(result) {
  if (typeof result === "boolean") return result;
  if (Array.isArray(result)) return result.length === 0;
  if (result && typeof result === "object") {
    if ("ok" in result) return Boolean(result.ok);
    if ("errors" in result) return !result.errors || result.errors.length === 0;
  }
  return true;
}

/**
 * Filters, picks, and stress-tests candidate drafts for an event (Spec 9.2, 9.3, 9.6).
 *
 * @param {{
 *   looks: any[] | Record<string, any>,
 *   spec: Record<string, any>,
 *   hints?: string[],
 *   excludedGroups?: Array<string | string[]>,
 *   runStress?: (look: any, spec: any) => any,
 *   compat?: any,
 *   font?: any,
 *   brand?: any,
 *   skeletons?: Record<string, any>,
 *   blocks?: Record<string, any>,
 *   themes?: Record<string, any>,
 * }} options
 * @returns {{
 *   looks: any[],
 *   notes: string[],
 *   dropped: Array<{ lookId: string, reason: string, errors?: any[] }>
 * }}
 */
export function draftsFor({
  looks,
  spec,
  hints = [],
  excludedGroups = [],
  runStress,
  compat = null,
  font,
  brand,
  skeletons = {},
  blocks = {},
  themes = {},
}) {
  const { eligible, removed } = filterEligible(looks, spec, compat);
  const notes = [];
  const dropped = [];

  // Determine stress evaluator
  const stressRunner =
    runStress ||
    (font
      ? createDefaultRunStress({ font, brand, skeletons, blocks, themes, stressSet })
      : null);

  // If initial eligibility is 0
  if (eligible.length === 0) {
    const reasonText = removed.map((r) => r.reason).join("; ");
    notes.push(
      reasonText ? `No looks fit this event: ${reasonText}.` : "No looks fit this event."
    );
    return { looks: [], notes, dropped };
  }

  let currentEligible = [...eligible];
  const currentExcluded = [...excludedGroups];

  while (currentEligible.length >= 3) {
    const chosen = pickThree(currentEligible, hints, currentExcluded);

    if (!chosen || chosen.length === 0) {
      notes.push("All eligible draft combinations have been excluded.");
      return { looks: [], notes, dropped };
    }

    // Stress test each look in the chosen group
    let failingLook = null;
    let failingReason = "";
    let failingErrors = [];

    if (stressRunner) {
      for (const look of chosen) {
        const result = stressRunner(look, spec);
        if (!isStressPassing(result)) {
          failingLook = look;
          failingReason =
            result?.reason || `Stress test produced unfixable validator errors`;
          failingErrors = result?.errors || [];
          break;
        }
      }
    }

    if (failingLook) {
      dropped.push({
        lookId: failingLook.id,
        reason: failingReason,
        errors: failingErrors,
      });
      notes.push(`Look ${failingLook.id} dropped: ${failingReason}.`);
      currentEligible = currentEligible.filter((l) => l.id !== failingLook.id);
      continue;
    }

    // If candidate group does not meet MIN_PAIR_DISTANCE spread (Spec 9.6)
    if (!meetsMinPairDistance(chosen)) {
      notes.push(
        "No draft group met the minimum distinctness spread of 5; showing best available group."
      );
    }

    // Report any looks filtered initially
    if (removed.length > 0) {
      notes.push(`Filtered looks: ${removed.map((r) => r.reason).join("; ")}.`);
    }

    return { looks: chosen, notes, dropped };
  }

  // Fewer than 3 looks remain
  if (currentEligible.length === 2) {
    const reasonText = removed.map((r) => r.reason).join("; ");
    notes.push(
      reasonText
        ? `Only 2 looks fit this event: ${reasonText}.`
        : "Only 2 looks fit this event."
    );
    return { looks: currentEligible, notes, dropped };
  }

  if (currentEligible.length === 1) {
    const reasonText = removed.map((r) => r.reason).join("; ");
    notes.push(
      reasonText
        ? `Only 1 look fits this event: ${reasonText}.`
        : "Only 1 look fits this event."
    );
    return { looks: currentEligible, notes, dropped };
  }

  notes.push("No looks fit this event.");
  return { looks: [], notes, dropped };
}
