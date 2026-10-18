// @ts-check
import { defaultBlocks } from "./templateData.js";
import { fitText, PT_TO_MM } from "./text.js";
import {
  contrastRatio,
  findBackgroundBehindText,
  validate,
} from "./validate.js";

/**
 * @module core/autofix
 * Pure functions for automatic defect repair (Part 11.3).
 *
 * Repairs in order:
 * a) Lower text size slightly for TEXT_OVERFLOW (D-22 bounds).
 * b) Hide optional decorative elements (optional: true).
 * c) Switch text fill to white or near-black for LOW_CONTRAST.
 * d) Switch to compact density (stub).
 */

/**
 * Clones a scene graph deeply to support rollback.
 *
 * @param {any[]} scene
 * @returns {any[]}
 */
function cloneScene(scene) {
  return scene.map((node) => ({
    ...node,
    box: { ...node.box },
    ...(node.lines ? { lines: [...node.lines] } : {}),
  }));
}

/**
 * Counts errors in an issue list (severity === "error").
 *
 * @param {any[]} issues
 * @returns {number}
 */
function countErrors(issues) {
  return issues.filter((i) => i.severity === "error").length;
}

/**
 * Creates a unique string identifier for an error issue.
 *
 * @param {any} issue
 * @returns {string}
 */
function errorKey(issue) {
  return `${issue.code}:${issue.nodeId || ""}`;
}

/**
 * Checks whether newIssues adds no new errors that were not in oldIssues.
 *
 * @param {any[]} oldIssues
 * @param {any[]} newIssues
 * @returns {boolean}
 */
function addsNoNewErrors(oldIssues, newIssues) {
  const oldErrorKeys = new Set(
    oldIssues.filter((i) => i.severity === "error").map(errorKey)
  );
  const newErrors = newIssues.filter((i) => i.severity === "error");
  return newErrors.every((i) => oldErrorKeys.has(errorKey(i)));
}

/**
 * Determines whether a repair improved the outcome:
 * reduces the total number of errors and introduces no new ones.
 *
 * @param {any[]} oldIssues
 * @param {any[]} newIssues
 * @returns {boolean}
 */
function isImprovement(oldIssues, newIssues) {
  const oldCount = countErrors(oldIssues);
  const newCount = countErrors(newIssues);
  return newCount < oldCount && addsNoNewErrors(oldIssues, newIssues);
}

/**
 * Finds the block element definition for a given node id.
 *
 * @param {string} nodeId
 * @param {Record<string, any>} [input]
 * @returns {any}
 */
function findBlockElement(nodeId, input) {
  const blocks = input?.blocks || defaultBlocks;
  for (const blockKey of Object.values(blocks)) {
    const block = typeof blockKey === "object" ? blockKey : defaultBlocks[blockKey];
    if (block?.elements) {
      const el = block.elements.find((/** @type {any} */ e) => e.id === nodeId);
      if (el) return el;
    }
  }
  return null;
}

/**
 * Identifies whether a text node binds person.name (Rule D-22).
 *
 * @param {any} node
 * @param {Record<string, any>} [input]
 * @returns {boolean}
 */
function isNameText(node, input) {
  if (node.bind === "person.name") return true;
  const el = findBlockElement(node.id, input);
  if (el?.bind === "person.name") return true;
  return false;
}

/**
 * Gets the declared minimum size in typographic points for a text node.
 *
 * @param {any} node
 * @param {Record<string, any>} [input]
 * @returns {number}
 */
function getDeclaredMinPt(node, input) {
  const el = findBlockElement(node.id, input);
  if (el?.size && Array.isArray(el.size) && typeof el.size[1] === "number") {
    return el.size[1];
  }
  if (typeof node.declaredMinPt === "number") {
    return node.declaredMinPt;
  }
  return node.sizeMm / PT_TO_MM;
}

/**
 * Computes the minimum allowable font size floor in points under Rule D-22.
 * - Name text: never lowered below its own declared minimum (6.5 pt).
 * - Non-name text:
 *     If declared minimum <= 5 pt, floor is declared minimum (never raises limit).
 *     Otherwise floor = max(5 pt, declaredMin - 1 pt).
 *
 * @param {any} node
 * @param {Record<string, any>} [input]
 * @returns {number}
 */
export function getTextFloorPt(node, input) {
  const isName = isNameText(node, input);
  const declaredMin = getDeclaredMinPt(node, input);

  if (isName) {
    return Math.max(6.5, declaredMin);
  }

  if (declaredMin <= 5) {
    return declaredMin;
  }

  return Math.max(5, declaredMin - 1);
}

/**
 * Builds validation context from input.
 *
 * @param {Record<string, any>} input
 * @returns {Record<string, any>}
 */
function buildContext(input) {
  const fontObj =
    input.font ||
    input.fonts?.heading ||
    (input.fonts && Object.values(input.fonts)[0]);
  return {
    card: input.card,
    brand: input.brand,
    font: fontObj,
    person: input.person,
    event: input.event,
    theme: input.theme,
  };
}

/**
 * Autofixes card defects in a bounded, deterministic pipeline (Part 11.3).
 * Pure function: takes input with scene and issues, returns updated scene, issues, and fixes.
 *
 * @param {Record<string, any>} input
 * @returns {{ scene: any[], issues: any[], fixes: Array<{ code: string, nodeId?: string, action: string }> }}
 */
export function autofix(input) {
  const context = buildContext(input);
  let currentScene = cloneScene(input.scene || []);
  let currentIssues = input.issues ? [...input.issues] : validate(currentScene, context);

  /** @type {Array<{ code: string, nodeId?: string, action: string }>} */
  const fixes = [];

  // Stop early if no errors exist
  if (countErrors(currentIssues) === 0) {
    return { scene: currentScene, issues: currentIssues, fixes };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Repair a) Lower text size slightly for TEXT_OVERFLOW (Rule D-22)
  // ─────────────────────────────────────────────────────────────────────────
  const overflowIssues = currentIssues.filter(
    (i) => i.severity === "error" && i.code === "TEXT_OVERFLOW"
  );
  const seenOverflowNodes = new Set();

  for (const issue of overflowIssues) {
    if (countErrors(currentIssues) === 0) break;
    if (!issue.nodeId || seenOverflowNodes.has(issue.nodeId)) continue;
    seenOverflowNodes.add(issue.nodeId);

    const node = currentScene.find((n) => n.id === issue.nodeId && n.type === "text");
    if (!node) continue;

    const floorPt = getTextFloorPt(node, input);
    const currentPt = node.sizeMm / PT_TO_MM;

    // If node is already at or below floor, autofix does nothing for it
    if (currentPt <= floorPt + 0.001) {
      continue;
    }

    const prevScene = cloneScene(currentScene);
    const prevIssues = currentIssues;

    // Re-layout: call fitText again with lowered minimum for that node
    const isName = isNameText(node, input);
    const font = isName
      ? context.font || input.fonts?.heading
      : input.fonts?.body || context.font || input.fonts?.heading;
    const el = findBlockElement(node.id, input);
    const startPt = el?.size?.[0] ?? currentPt;
    const maxLines = el?.maxLines || (node.lines.length > 1 ? 2 : 1);

    if (font) {
      const fit = fitText({
        text: node.lines.join(" "),
        boxWidthMm: node.box.w,
        boxHeightMm: node.box.h,
        sizeRangePt: [startPt, floorPt],
        oneLineFloorPt: el?.oneLineFloor,
        maxLines,
        font,
      });
      node.lines = fit.lines;
      node.sizeMm = fit.sizeMm;
      node.status = fit.status;
    } else {
      node.sizeMm = floorPt * PT_TO_MM;
    }

    const nextIssues = validate(currentScene, context);

    if (isImprovement(prevIssues, nextIssues)) {
      currentIssues = nextIssues;
      fixes.push({
        code: "TEXT_OVERFLOW",
        nodeId: node.id,
        action: `Lowered font size to ${node.sizeMm.toFixed(2)} mm (${(node.sizeMm / PT_TO_MM).toFixed(1)} pt)`,
      });
    } else {
      currentScene = prevScene;
      currentIssues = prevIssues;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Repair b) Hide optional decorative elements (optional: true)
  // ─────────────────────────────────────────────────────────────────────────
  if (countErrors(currentIssues) > 0) {
    const candidateErrors = currentIssues.filter(
      (i) => i.severity === "error" && i.nodeId
    );
    const triedHideIds = new Set();

    for (const issue of candidateErrors) {
      if (countErrors(currentIssues) === 0) break;

      // Extract all node IDs involved in the issue
      /** @type {string[]} */
      const involvedIds = [];
      if (issue.nodeId) involvedIds.push(issue.nodeId);
      const overlapMatch = issue.message?.match(/overlaps with "([^"]+)"/);
      if (overlapMatch && overlapMatch[1]) {
        involvedIds.push(overlapMatch[1]);
      }

      for (const id of involvedIds) {
        if (countErrors(currentIssues) === 0) break;
        if (triedHideIds.has(id)) continue;
        triedHideIds.add(id);

        const targetNode = currentScene.find((n) => n.id === id);
        // Hide only nodes with optional: true that are involved in the error.
        // Elements with decor: true but not optional: true must NEVER be hidden.
        if (!targetNode || targetNode.optional !== true) {
          continue;
        }

        const prevScene = cloneScene(currentScene);
        const prevIssues = currentIssues;

        currentScene = currentScene.filter((n) => n.id !== id);
        const nextIssues = validate(currentScene, context);

        if (isImprovement(prevIssues, nextIssues)) {
          currentIssues = nextIssues;
          fixes.push({
            code: issue.code,
            nodeId: id,
            action: `Hidden optional element "${id}"`,
          });
        } else {
          currentScene = prevScene;
          currentIssues = prevIssues;
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Repair c) Switch text fill to white or near-black for LOW_CONTRAST
  // ─────────────────────────────────────────────────────────────────────────
  if (countErrors(currentIssues) > 0) {
    const contrastIssues = currentIssues.filter(
      (i) => i.severity === "error" && i.code === "LOW_CONTRAST"
    );
    const triedContrastNodes = new Set();

    for (const issue of contrastIssues) {
      if (countErrors(currentIssues) === 0) break;
      if (!issue.nodeId || triedContrastNodes.has(issue.nodeId)) continue;
      triedContrastNodes.add(issue.nodeId);

      const node = currentScene.find((n) => n.id === issue.nodeId && n.type === "text");
      if (!node) continue;

      const bgFill = findBackgroundBehindText(node, currentScene, context.theme);
      const whiteRatio = contrastRatio("#FFFFFF", bgFill);
      const darkRatio = contrastRatio("#111827", bgFill);

      const candidates =
        whiteRatio >= darkRatio
          ? ["#FFFFFF", "#111827", "#000000"]
          : ["#111827", "#000000", "#FFFFFF"];

      for (const candidate of candidates) {
        if (candidate === node.fill) continue;

        const prevScene = cloneScene(currentScene);
        const prevIssues = currentIssues;

        node.fill = candidate;
        const nextIssues = validate(currentScene, context);

        if (isImprovement(prevIssues, nextIssues)) {
          currentIssues = nextIssues;
          fixes.push({
            code: "LOW_CONTRAST",
            nodeId: node.id,
            action: `Changed text fill to ${candidate}`,
          });
          break;
        } else {
          currentScene = prevScene;
          currentIssues = prevIssues;
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Repair d) Switch to compact density (stub per Task 6 spec)
  // ─────────────────────────────────────────────────────────────────────────
  // Density is not currently supported in renderer or templateData.
  // Marked stub: does nothing and does NOT appear in fixes.
  if (countErrors(currentIssues) > 0) {
    // No-op stub. When density is implemented in Task 7+, density adjustments will go here.
  }

  return { scene: currentScene, issues: currentIssues, fixes };
}
