// @ts-check
import { measure } from "./text.js";

/**
 * @module core/validate
 * Pure-function validator for card scenes and event data (Part 11).
 * Each check is a pure function: scene in, issues out (D-06, 11.4).
 */

/** Shared line height factor used by both render.js and validate.js (D-21). */
export const LINE_HEIGHT = 1.25;

/**
 * Calculates WCAG 2.1 relative luminance from a 6-digit hex color string.
 *
 * @param {string} hex
 * @returns {number}
 */
export function relativeLuminance(hex) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#") || hex.length !== 7) {
    return 1;
  }
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const toLinear = (/** @type {number} */ c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Calculates WCAG 2.1 contrast ratio between two hex colors.
 *
 * @param {string} fgHex
 * @param {string} bgHex
 * @returns {number}
 */
export function contrastRatio(fgHex, bgHex) {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Finds the background color behind a text node.
 * Uses the topmost decorative rect that geometrically contains the text box;
 * falls back to theme background color, or #FFFFFF if not available (D-21).
 *
 * @param {any} textNode
 * @param {any[]} scene
 * @param {any} [theme]
 * @returns {string}
 */
export function findBackgroundBehindText(textNode, scene, theme) {
  const decorRects = scene.filter(
    (n) =>
      n.type === "rect" &&
      n.decor === true &&
      n.box.x <= textNode.box.x + 0.01 &&
      n.box.y <= textNode.box.y + 0.01 &&
      n.box.x + n.box.w >= textNode.box.x + textNode.box.w - 0.01 &&
      n.box.y + n.box.h >= textNode.box.y + textNode.box.h - 0.01
  );
  if (decorRects.length > 0) {
    return decorRects[decorRects.length - 1].fill;
  }
  return theme?.colors?.background || "#FFFFFF";
}

/**
 * TEXT_TRUNCATED (Warning)
 * Flags text nodes whose layout status is "truncated".
 *
 * @param {any[]} scene
 * @returns {any[]}
 */
export function checkTextTruncated(scene) {
  /** @type {any[]} */
  const issues = [];
  for (const node of scene) {
    if (node.type === "text" && node.status === "truncated") {
      issues.push({
        severity: "warning",
        code: "TEXT_TRUNCATED",
        nodeId: node.id,
        message: `Text was truncated to fit the available space: "${node.lines?.join(" ") || ""}"`,
      });
    }
  }
  return issues;
}

/**
 * TEXT_OVERFLOW (Error)
 * Re-measures each text line with the font; fails if width or height exceeds bounding box.
 * Skips gracefully if font is not provided in context.
 *
 * @param {any[]} scene
 * @param {any} [font]
 * @returns {any[]}
 */
export function checkTextOverflow(scene, font) {
  if (!font) return [];
  /** @type {any[]} */
  const issues = [];
  for (const node of scene) {
    if (node.type !== "text" || !Array.isArray(node.lines)) continue;
    let overflowing = false;
    for (const line of node.lines) {
      const lineWidth = measure(line, node.sizeMm, font);
      if (lineWidth > node.box.w + 0.01) {
        overflowing = true;
        break;
      }
    }
    const totalHeight = (node.lines.length - 1) * node.sizeMm * LINE_HEIGHT + node.sizeMm;
    if (totalHeight > node.box.h + 0.01) {
      overflowing = true;
    }
    if (overflowing) {
      issues.push({
        severity: "error",
        code: "TEXT_OVERFLOW",
        nodeId: node.id,
        message: `Text exceeds its bounding box: "${node.lines.join(" ")}"`,
      });
    }
  }
  return issues;
}

/**
 * OVERLAP (Error)
 * Checks rectangle intersection among content elements only (node.decor !== true).
 *
 * @param {any[]} scene
 * @returns {any[]}
 */
export function checkOverlap(scene) {
  /** @type {any[]} */
  const issues = [];
  const contentNodes = scene.filter((n) => n.decor !== true);
  // Tolerance of 0.15mm avoids false-positives from slot percentage rounding at adjacent boundaries
  const TOLERANCE = 0.15;
  for (let i = 0; i < contentNodes.length; i++) {
    for (let j = i + 1; j < contentNodes.length; j++) {
      const a = contentNodes[i];
      const b = contentNodes[j];
      const overlaps =
        a.box.x < b.box.x + b.box.w - TOLERANCE &&
        a.box.x + a.box.w > b.box.x + TOLERANCE &&
        a.box.y < b.box.y + b.box.h - TOLERANCE &&
        a.box.y + a.box.h > b.box.y + TOLERANCE;
      if (overlaps) {
        issues.push({
          severity: "error",
          code: "OVERLAP",
          nodeId: a.id,
          message: `Element "${a.id}" overlaps with "${b.id}"`,
        });
      }
    }
  }
  return issues;
}

/**
 * OUTSIDE_SAFE_MARGIN (Error)
 * Verifies that content elements (node.decor !== true) stay within safe margin.
 * No hardcoded default; skips if card.safeMarginMm is missing from context.
 *
 * @param {any[]} scene
 * @param {any} [card]
 * @returns {any[]}
 */
export function checkOutsideSafeMargin(scene, card) {
  if (!card || typeof card.safeMarginMm !== "number") {
    // safeMarginMm is not defined in context; skipping margin check per D-21
    return [];
  }
  const margin = card.safeMarginMm;
  const cardW = card.widthMm;
  const cardH = card.heightMm;
  if (typeof cardW !== "number" || typeof cardH !== "number") {
    return [];
  }
  /** @type {any[]} */
  const issues = [];
  for (const node of scene) {
    if (node.decor === true) continue;
    if (
      node.box.x < margin - 0.01 ||
      node.box.y < margin - 0.01 ||
      node.box.x + node.box.w > cardW - margin + 0.01 ||
      node.box.y + node.box.h > cardH - margin + 0.01
    ) {
      issues.push({
        severity: "error",
        code: "OUTSIDE_SAFE_MARGIN",
        nodeId: node.id,
        message: `Element "${node.id}" is outside the safe margin (${margin} mm)`,
      });
    }
  }
  return issues;
}

/**
 * LOW_CONTRAST (Error)
 * Checks WCAG 2.1 contrast ratio for text elements against their background.
 * Minimum 4.5:1, or 3.0:1 for large text (>= 18 pt / ~6.35 mm).
 *
 * @param {any[]} scene
 * @param {any} [theme]
 * @returns {any[]}
 */
export function checkLowContrast(scene, theme) {
  /** @type {any[]} */
  const issues = [];
  for (const node of scene) {
    if (node.type !== "text") continue;
    const bgFill = findBackgroundBehindText(node, scene, theme);
    const ratio = contrastRatio(node.fill, bgFill);
    const isLarge = node.sizeMm >= 6.35;
    const threshold = isLarge ? 3.0 : 4.5;
    if (ratio < threshold - 0.01) {
      issues.push({
        severity: "error",
        code: "LOW_CONTRAST",
        nodeId: node.id,
        message: `Text contrast ratio (${ratio.toFixed(2)}:1) is below WCAG threshold (${threshold}:1)`,
      });
    }
  }
  return issues;
}

/**
 * UNFILLED_DATA (Error)
 * Flags leftover placeholders (e.g. $var, {{var}}) or literal null / undefined printed in text.
 * Bare "$" or words like "Cash$" pass.
 *
 * @param {any[]} scene
 * @returns {any[]}
 */
export function checkUnfilledData(scene) {
  /** @type {any[]} */
  const issues = [];
  const placeholderRegex = /(\$[A-Za-z_][\w.]*|\{\{.*?\}\}|undefined|null)/;
  for (const node of scene) {
    if (node.type !== "text" || !Array.isArray(node.lines)) continue;
    for (const line of node.lines) {
      if (placeholderRegex.test(line)) {
        issues.push({
          severity: "error",
          code: "UNFILLED_DATA",
          nodeId: node.id,
          message: `Text contains unfilled placeholder or data binding in "${line}"`,
        });
        break;
      }
    }
  }
  return issues;
}

/**
 * NO_PHOTO (Warning)
 * Emits warning if the person fixture or data has no photo.
 *
 * @param {any} [person]
 * @param {any[]} [_scene]
 * @returns {any[]}
 */
export function checkNoPhoto(person, _scene) {
  if (!person) return [];
  if (person.photo === null || person.photo === undefined || person.flags?.includes("NO_PHOTO")) {
    return [
      {
        severity: "warning",
        code: "NO_PHOTO",
        nodeId: "photo",
        message: "Participant has no photo; fallback avatar or placeholder used",
      },
    ];
  }
  return [];
}

/**
 * LOGO_DISTORTED (Error)
 * Checks that an image logo's drawn aspect ratio does not deviate from source by > 0.5%.
 *
 * @param {any[]} scene
 * @returns {any[]}
 */
export function checkLogoDistorted(scene) {
  /** @type {any[]} */
  const issues = [];
  for (const node of scene) {
    if (node.type === "image" && typeof node.srcW === "number" && typeof node.srcH === "number") {
      const drawnRatio = node.box.w / node.box.h;
      const srcRatio = node.srcW / node.srcH;
      if (srcRatio > 0 && Math.abs(drawnRatio - srcRatio) / srcRatio > 0.005) {
        issues.push({
          severity: "error",
          code: "LOGO_DISTORTED",
          nodeId: node.id,
          message: "Logo aspect ratio differs from source by more than 0.5%",
        });
      }
    }
  }
  return issues;
}

/**
 * LOGO_TOO_SMALL (Error)
 * Checks if a logo element is smaller than the brand kit's minWidthMm.
 *
 * @param {any[]} scene
 * @param {any} [brand]
 * @returns {any[]}
 */
export function checkLogoTooSmall(scene, brand) {
  if (!brand?.logos) return [];
  /** @type {any[]} */
  const issues = [];
  for (const node of scene) {
    if (node.id === "logo1" && brand.logos.primary?.minWidthMm) {
      if (node.box.w < brand.logos.primary.minWidthMm - 0.01) {
        issues.push({
          severity: "error",
          code: "LOGO_TOO_SMALL",
          nodeId: node.id,
          message: `Logo width (${node.box.w} mm) is below minimum required (${brand.logos.primary.minWidthMm} mm)`,
        });
      }
    }
    if (node.id === "logo2" && brand.logos.secondary?.minWidthMm) {
      if (node.box.w < brand.logos.secondary.minWidthMm - 0.01) {
        issues.push({
          severity: "error",
          code: "LOGO_TOO_SMALL",
          nodeId: node.id,
          message: `Logo width (${node.box.w} mm) is below minimum required (${brand.logos.secondary.minWidthMm} mm)`,
        });
      }
    }
  }
  return issues;
}

/**
 * LOGO_MISSING (Error)
 * Checks that mandatory logos exist in the scene. A placeholder node counts as present (D-21).
 *
 * @param {any[]} scene
 * @param {any} [brand]
 * @returns {any[]}
 */
export function checkLogoMissing(scene, brand) {
  if (!brand?.logos) return [];
  /** @type {any[]} */
  const issues = [];
  if (brand.logos.primary) {
    const hasPrimary = scene.some((n) => n.id === "logo1");
    if (!hasPrimary) {
      issues.push({
        severity: "error",
        code: "LOGO_MISSING",
        nodeId: "logo1",
        message: "Mandatory primary logo is missing from the scene",
      });
    }
  }
  if (brand.logos.secondary) {
    const hasSecondary = scene.some((n) => n.id === "logo2");
    if (!hasSecondary) {
      issues.push({
        severity: "error",
        code: "LOGO_MISSING",
        nodeId: "logo2",
        message: "Mandatory secondary logo is missing from the scene",
      });
    }
  }
  return issues;
}

/**
 * LOGO_CLEARSPACE (Error)
 * Checks that no other content element encroaches on the required clear space around logos.
 *
 * @param {any[]} scene
 * @param {any} [brand]
 * @returns {any[]}
 */
export function checkLogoClearspace(scene, brand) {
  if (!brand?.logos) return [];
  /** @type {any[]} */
  const issues = [];
  const contentNodes = scene.filter((n) => n.decor !== true);

  for (const node of scene) {
    if (node.type !== "image") continue; // Clearspace applies to real logo images, not placeholders (D-21)
    let clearSpaceMm = 0;
    if (node.id === "logo1" && typeof brand.logos.primary?.clearSpaceMm === "number") {
      clearSpaceMm = brand.logos.primary.clearSpaceMm;
    } else if (node.id === "logo2" && typeof brand.logos.secondary?.clearSpaceMm === "number") {
      clearSpaceMm = brand.logos.secondary.clearSpaceMm;
    }
    if (clearSpaceMm <= 0) continue;

    for (const other of contentNodes) {
      if (other.id === node.id) continue;
      const dx = Math.max(0, node.box.x - (other.box.x + other.box.w), other.box.x - (node.box.x + node.box.w));
      const dy = Math.max(0, node.box.y - (other.box.y + other.box.h), other.box.y - (node.box.y + node.box.h));
      const distance = Math.max(dx, dy);
      if (distance < clearSpaceMm - 0.01) {
        issues.push({
          severity: "error",
          code: "LOGO_CLEARSPACE",
          nodeId: node.id,
          message: `Element "${other.id}" encroaches on clear space of logo "${node.id}" (${clearSpaceMm} mm required)`,
        });
      }
    }
  }
  return issues;
}

/**
 * QR_TOO_SMALL (Error)
 * Checks that QR code is at least 15x15 mm (Part 11.1).
 *
 * @param {any[]} scene
 * @returns {any[]}
 */
export function checkQrTooSmall(scene) {
  /** @type {any[]} */
  const issues = [];
  for (const node of scene) {
    if (node.id === "qr" || node.id.includes("qr")) {
      if (node.box.w < 15 - 0.01 || node.box.h < 15 - 0.01) {
        issues.push({
          severity: "error",
          code: "QR_TOO_SMALL",
          nodeId: node.id,
          message: `QR code size (${node.box.w}x${node.box.h} mm) is smaller than minimum 15x15 mm`,
        });
      }
    }
  }
  return issues;
}

/**
 * UNCONFIRMED_VALUE (Error)
 * Flags any event value whose provenance source is "suggestion" and not confirmed.
 *
 * @param {any} [event]
 * @returns {any[]}
 */
export function checkUnconfirmedValue(event) {
  if (!event) return [];
  /** @type {any[]} */
  const issues = [];

  function checkProvenance(/** @type {any} */ val, /** @type {string} */ label) {
    if (val && typeof val === "object" && val.source === "suggestion" && !val.confirmed) {
      issues.push({
        severity: "error",
        code: "UNCONFIRMED_VALUE",
        message: `Field "${label}" has an unconfirmed suggestion`,
      });
    }
  }

  if (event.event) {
    for (const [key, val] of Object.entries(event.event)) {
      checkProvenance(val, `event.${key}`);
    }
  }
  if (Array.isArray(event.roles)) {
    for (const role of event.roles) {
      checkProvenance(role.color, `role.${role.id}.color`);
    }
  }
  if (event.fields) {
    checkProvenance(event.fields, "fields");
  }

  return issues;
}

/**
 * TEXT_UNSUPPORTED_GLYPH (Error)
 * Checks each text node for any character that maps to glyph index 0 (.notdef) in its font.
 *
 * @param {any[]} scene
 * @param {any} [font]
 * @param {any} [fonts]
 * @returns {any[]}
 */
export function checkTextUnsupportedGlyph(scene, font, fonts) {
  if (!font && !fonts) return [];
  /** @type {any[]} */
  const issues = [];
  for (const node of scene) {
    if (node.type !== "text" || !Array.isArray(node.lines)) continue;
    const isHeading = node.fontRole === "heading" || node.bind === "person.name" || node.id === "name";
    const nodeFont = (isHeading ? fonts?.heading : fonts?.body) || font || fonts?.heading;
    if (!nodeFont || typeof nodeFont.charToGlyph !== "function") continue;

    let unsupportedChar = null;
    for (const line of node.lines) {
      for (const char of line) {
        const glyph = nodeFont.charToGlyph(char);
        if (glyph && glyph.index === 0) {
          unsupportedChar = char;
          break;
        }
      }
      if (unsupportedChar) break;
    }

    if (unsupportedChar) {
      issues.push({
        severity: "error",
        code: "TEXT_UNSUPPORTED_GLYPH",
        nodeId: node.id,
        message: `Text in node "${node.id}" contains unsupported character "${unsupportedChar}" (glyph index 0 in font)`,
      });
    }
  }
  return issues;
}

/**
 * UNKNOWN_ROLE_ID (Error)
 * Checks that person.roleId is present, non-empty, a string, and exactly matches
 * a role id defined in event.roles (exact, case-sensitive).
 *
 * @param {any} [person]
 * @param {any} [event]
 * @param {any[]} [scene]
 * @returns {any[]}
 */
export function checkUnknownRoleId(person, event, scene = []) {
  if (!person || !event) return [];
  const roleId = person.roleId;
  const personId = person.id || "unknown";

  const isString = typeof roleId === "string";
  const isNonEmpty = isString && roleId.trim().length > 0;
  const roles = Array.isArray(event.roles) ? event.roles : (Array.isArray(event?.event?.roles) ? event.event.roles : []);
  const matchesRole = isNonEmpty && roles.some((r) => r && r.id === roleId);

  if (!matchesRole) {
    const roleNode = Array.isArray(scene) ? scene.find((n) => n.id === "role") : null;
    return [
      {
        severity: "error",
        code: "UNKNOWN_ROLE_ID",
        nodeId: roleNode ? roleNode.id : "role",
        message: `Person "${personId}" has invalid or unrecognised roleId "${String(roleId)}"; must match an id in event.roles`,
      },
    ];
  }

  return [];
}

/**
 * Validates a scene graph and context against all design and brand rules.
 *
 * @param {any[]} scene - Array of SceneNodes
 * @param {Record<string, any>} [context={}] - Optional context { card, brand, font, fonts, person, event, theme }
 * @returns {any[]} List of validation issues
 */
export function validate(scene, context = {}) {
  if (!Array.isArray(scene)) return [];
  /** @type {any[]} */
  const issues = [];

  issues.push(...checkTextUnsupportedGlyph(scene, context.font, context.fonts));
  issues.push(...checkTextTruncated(scene));
  issues.push(...checkTextOverflow(scene, context.font));
  issues.push(...checkOverlap(scene));
  issues.push(...checkOutsideSafeMargin(scene, context.card));
  issues.push(...checkLowContrast(scene, context.theme));
  issues.push(...checkUnfilledData(scene));
  issues.push(...checkNoPhoto(context.person, scene));
  issues.push(...checkLogoDistorted(scene));
  issues.push(...checkLogoTooSmall(scene, context.brand));
  issues.push(...checkLogoMissing(scene, context.brand));
  issues.push(...checkLogoClearspace(scene, context.brand));
  issues.push(...checkQrTooSmall(scene));
  issues.push(...checkUnconfirmedValue(context.event));
  issues.push(...checkUnknownRoleId(context.person, context.event, scene));

  return issues;
}

