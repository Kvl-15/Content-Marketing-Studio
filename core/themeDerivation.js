// @ts-check
import { contrastRatio, relativeLuminance } from "./validate.js";

/**
 * @module core/themeDerivation
 * Pure-function theme derivation from event palettes (D-24).
 * Translates 1 to 3 event colors into light, dark, and colour-field themes
 * with guaranteed WCAG 2.1 contrast ratios.
 */

/** Default event palette used for reference cards and golden files. */
export const DEFAULT_PALETTE = ["#0085FF", "#111827", "#F9FAFB"];

/**
 * Converts a 6-digit hex string into RGB values [0..255].
 *
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexToRgb(hex) {
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return [r, g, b];
}

/**
 * Converts RGB [0..255] into a 6-digit hex color string.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
export function rgbToHex(r, g, b) {
  const clamp = (/** @type {number} */ v) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`.toUpperCase();
}

/**
 * Converts RGB [0..255] to HSL [h: 0..360, s: 0..1, l: 0..1].
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {[number, number, number]}
 */
export function rgbToHsl(r, g, b) {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
      case gNorm: h = (bNorm - rNorm) / d + 2; break;
      case bNorm: h = (rNorm - gNorm) / d + 4; break;
    }
    h *= 60;
  }
  return [h, s, l];
}

/**
 * Converts HSL [h: 0..360, s: 0..1, l: 0..1] to RGB [0..255].
 *
 * @param {number} h
 * @param {number} s
 * @param {number} l
 * @returns {[number, number, number]}
 */
export function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const hue2rgb = (/** @type {number} */ p, /** @type {number} */ q, /** @type {number} */ t) => {
    let tAdj = t;
    if (tAdj < 0) tAdj += 1;
    if (tAdj > 1) tAdj -= 1;
    if (tAdj < 1 / 6) return p + (q - p) * 6 * tAdj;
    if (tAdj < 1 / 2) return q;
    if (tAdj < 2 / 3) return p + (q - p) * (2 / 3 - tAdj) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hNorm = h / 360;

  const r = Math.round(hue2rgb(p, q, hNorm + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, hNorm) * 255);
  const b = Math.round(hue2rgb(p, q, hNorm - 1 / 3) * 255);
  return [r, g, b];
}

/**
 * Adjusts lightness of a color in HSL to ensure it achieves minimum contrast against bgHex.
 *
 * @param {string} hex
 * @param {string} bgHex
 * @param {number} [targetContrast=4.5]
 * @returns {string}
 */
export function ensureContrast(hex, bgHex, targetContrast = 4.5) {
  if (contrastRatio(hex, bgHex) >= targetContrast) {
    return hex;
  }

  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const whiteRatio = contrastRatio("#FFFFFF", bgHex);
  const darkRatio = contrastRatio("#000000", bgHex);
  const makeDarker = darkRatio > whiteRatio;

  let currentL = l;
  for (let i = 0; i < 20; i++) {
    currentL = makeDarker ? Math.max(0.01, currentL - 0.05) : Math.min(0.99, currentL + 0.05);
    const [nr, ng, nb] = hslToRgb(h, s, currentL);
    const candidate = rgbToHex(nr, ng, nb);
    if (contrastRatio(candidate, bgHex) >= targetContrast) {
      return candidate;
    }
  }

  if (makeDarker) {
    return contrastRatio("#111827", bgHex) >= targetContrast ? "#111827" : "#000000";
  }
  return "#FFFFFF";
}

/**
 * Derives a complete Theme object from 1 to 3 event palette colors (D-24).
 * Pure function: deterministic and bounded.
 *
 * @param {string[]} palette - Array of 1 to 3 hex colors
 * @param {"light" | "dark" | "colour-field" | "blue" | "bright"} mode
 * @param {"event-led" | "role-led"} [strategy="event-led"]
 * @param {string} [themeId="derived"]
 * @returns {import("./schemas.js").Theme extends import("zod").ZodType<infer T> ? T : any}
 */
export function deriveTheme(palette, mode, strategy = "event-led", themeId = "derived") {
  const safePalette = Array.isArray(palette) && palette.length > 0 ? palette : DEFAULT_PALETTE;
  const primary = safePalette[0] || "#0085FF";
  const secondary = safePalette[1] || safePalette[0];

  let background = "#FFFFFF";
  let text = "#111827";
  let accent = primary;

  switch (mode) {
    case "dark": {
      // Find the darkest colour in safePalette or darken primary keeping hue and saturation
      let baseDark = safePalette[0];
      let minLum = relativeLuminance(baseDark);
      for (const col of safePalette) {
        const lum = relativeLuminance(col);
        if (lum < minLum) {
          minLum = lum;
          baseDark = col;
        }
      }
      const [dr, dg, db] = hexToRgb(baseDark);
      const [dh, ds, dl] = rgbToHsl(dr, dg, db);
      // Keep hue and saturation, clamp L to 0.10 - 0.14 range
      const targetL = Math.max(0.08, Math.min(0.14, dl > 0.14 ? 0.11 : Math.max(0.08, dl)));
      const [bgR, bgG, bgB] = hslToRgb(dh, Math.min(ds, 0.60), targetL);
      background = rgbToHex(bgR, bgG, bgB);
      text = ensureContrast("#F8FAFC", background, 4.5);
      accent = ensureContrast(primary, background, 3.5);
      break;
    }
    case "colour-field":
    case "blue": {
      // In bold/blue theme or colour-field mode:
      if (mode === "blue") {
        background = "#FFFFFF";
        text = "#111827";
        accent = primary;
      } else {
        background = primary;
        // If primary is in the mid-tone range where neither white nor near-black achieves 4.5:1 contrast:
        if (
          contrastRatio("#FFFFFF", background) < 4.5 &&
          contrastRatio("#111827", background) < 4.5
        ) {
          const [pr, pg, pb] = hexToRgb(background);
          const [ph, ps, pl] = rgbToHsl(pr, pg, pb);
          let adjL = pl;
          for (let step = 0; step < 12; step++) {
            adjL = Math.max(0.04, adjL - 0.03);
            const [nr, ng, nb] = hslToRgb(ph, ps, adjL);
            const candidateBg = rgbToHex(nr, ng, nb);
            if (contrastRatio("#FFFFFF", candidateBg) >= 4.5) {
              background = candidateBg;
              break;
            }
          }
        }
        const whiteRatio = contrastRatio("#FFFFFF", background);
        const darkRatio = contrastRatio("#111827", background);
        text = whiteRatio >= darkRatio ? "#FFFFFF" : "#111827";
        accent = ensureContrast(secondary, background, 3.0);
      }
      break;
    }
    case "bright": {
      const [r, g, b] = hexToRgb(primary);
      const [h, s] = rgbToHsl(r, g, b);
      const [tr, tg, tb] = hslToRgb(h, Math.min(s, 0.45), 0.94);
      background = rgbToHex(tr, tg, tb);
      text = ensureContrast("#111827", background, 4.5);
      accent = ensureContrast(primary, background, 3.0);
      break;
    }
    case "light":
    default: {
      background = "#FFFFFF";
      text = "#111827";
      accent = ensureContrast(primary, background, 3.0);
      break;
    }
  }

  // Ensure absolute WCAG contrast for text against background
  text = ensureContrast(text, background, 4.5);

  return {
    id: themeId,
    colors: {
      background,
      text,
      accent,
    },
    fonts: {
      heading: "Roboto",
      body: "Roboto",
    },
  };
}

/**
 * Checks if an event palette is compatible with a given look (spec 9.5).
 *
 * @param {any} look
 * @param {string[]} palette
 * @returns {{ compatible: boolean, reason?: string }}
 */
export function isPaletteCompatible(look, palette) {
  if (!Array.isArray(palette) || palette.length === 0) {
    return { compatible: true };
  }

  const primary = palette[0];
  const mode = look?.attributes?.mode || "light";

  if (mode === "colour-field") {
    const lum = relativeLuminance(primary);
    // Extreme pale yellow or extreme dark cannot serve as a distinct vibrant colour-field
    if (lum > 0.90) {
      return {
        compatible: false,
        reason: `Primary color "${primary}" is too light for colour-field mode`,
      };
    }
    const [r, g, b] = hexToRgb(primary);
    const [, s] = rgbToHsl(r, g, b);
    if (s < 0.15 && lum > 0.80) {
      return {
        compatible: false,
        reason: `Primary color "${primary}" lacks sufficient saturation for colour-field mode`,
      };
    }
  }

  return { compatible: true };
}
