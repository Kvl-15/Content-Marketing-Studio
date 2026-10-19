// @ts-check
/**
 * @module core/text
 * Text measuring, line wrapping, and dynamic size fitting using opentype.js.
 * Pure functions: no filesystem, database, or network I/O (D-06).
 */

import opentype from "opentype.js";

export const PT_TO_MM = 0.3528;

/**
 * Converts a text line into SVG path data with 3 decimals using opentype.js.
 * Uses manual glyph iteration to handle variable fonts and GSUB substitutions cleanly.
 *
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} sizeMm
 * @param {import("opentype.js").Font} font
 * @returns {string}
 */
export function textToPathData(text, x, y, sizeMm, font) {
  if (!text || !font || typeof font.charToGlyph !== "function") return "";
  try {
    const scale = (1 / (font.unitsPerEm || 1000)) * sizeMm;
    const path = new opentype.Path();
    let curX = x;
    for (let i = 0; i < text.length; i++) {
      const glyph = font.charToGlyph(text[i]);
      if (glyph && typeof glyph.getPath === "function") {
        const gPath = glyph.getPath(curX, y, sizeMm);
        if (gPath && Array.isArray(gPath.commands)) {
          path.commands.push(...gPath.commands);
        }
        curX += (glyph.advanceWidth || 0) * scale;
        if (i > 0 && typeof font.getKerningValue === "function") {
          const prevGlyph = font.charToGlyph(text[i - 1]);
          const kerning = font.getKerningValue(prevGlyph, glyph);
          curX += (kerning || 0) * scale;
        }
      }
    }
    return path.toPathData(3);
  } catch (_e) {
    return "";
  }
}

/**
 * Measures the width of a string in millimeters using an opentype font.
 *
 * @param {string} text
 * @param {number} sizeMm
 * @param {import("opentype.js").Font} font
 * @returns {number} width in millimeters
 */
export function measure(text, sizeMm, font) {
  if (!text || !font) return 0;
  try {
    return font.getAdvanceWidth(text, sizeMm);
  } catch (_e) {
    const scale = (1 / font.unitsPerEm) * sizeMm;
    let width = 0;
    for (let i = 0; i < text.length; i++) {
      const glyph = font.charToGlyph(text[i]);
      width += (glyph.advanceWidth || 0) * scale;
      if (i > 0 && typeof font.getKerningValue === "function") {
        const prevGlyph = font.charToGlyph(text[i - 1]);
        const kerning = font.getKerningValue(prevGlyph, glyph);
        width += (kerning || 0) * scale;
      }
    }
    return width;
  }
}

/**
 * Wraps text into lines against maxWidthMm at a given sizeMm.
 * Breaks at spaces. If forceBreak is true, words wider than maxWidthMm
 * are split character-by-character.
 *
 * @param {string} text
 * @param {number} maxWidthMm
 * @param {number} sizeMm
 * @param {import("opentype.js").Font} font
 * @param {boolean} [forceBreak=false]
 * @returns {string[]}
 */
export function wrap(text, maxWidthMm, sizeMm, font, forceBreak = false) {
  if (!text) return [""];
  const words = text.trim().split(/\s+/);
  if (words.length === 0 || words[0] === "") return [""];

  /** @type {string[]} */
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const wordWidth = measure(word, sizeMm, font);

    if (wordWidth > maxWidthMm) {
      if (!forceBreak) {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = "";
        }
        lines.push(word);
      } else {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = "";
        }
        let remaining = word;
        while (remaining.length > 0) {
          let chunk = "";
          for (let i = 0; i < remaining.length; i++) {
            const nextChunk = remaining.slice(0, i + 1);
            if (measure(nextChunk, sizeMm, font) <= maxWidthMm) {
              chunk = nextChunk;
            } else {
              break;
            }
          }
          if (!chunk) {
            chunk = remaining[0];
          }
          remaining = remaining.slice(chunk.length);
          if (remaining.length > 0) {
            lines.push(chunk);
          } else {
            currentLine = chunk;
          }
        }
      }
    } else {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (measure(candidate, sizeMm, font) <= maxWidthMm) {
        currentLine = candidate;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Fits text within a bounding box following D-20 (Stage 1 shrink -> Stage 2 wrap -> Stage 3 truncate).
 *
 * @param {object} params
 * @param {string} params.text
 * @param {number} params.boxWidthMm
 * @param {number} [params.boxHeightMm]
 * @param {[number, number]} params.sizeRangePt - [startPt, minPt]
 * @param {number} [params.oneLineFloorPt] - threshold down to which Stage 1 single-line shrink is tried
 * @param {number} [params.maxLines=2]
 * @param {import("opentype.js").Font} params.font
 * @returns {{ lines: string[], sizeMm: number, status: "ok" | "truncated" }}
 */
export function fitText({
  text,
  boxWidthMm,
  boxHeightMm: _boxHeightMm,
  sizeRangePt: [startPt, minPt],
  oneLineFloorPt,
  maxLines = 2,
  font,
}) {
  const startMm = startPt * PT_TO_MM;
  const minMm = minPt * PT_TO_MM;
  const floorMm =
    (oneLineFloorPt !== undefined ? oneLineFloorPt : minPt) * PT_TO_MM;

  const floorStep = Math.ceil(floorMm * 10 - 0.0001);
  const minStep = Math.ceil(minMm * 10 - 0.0001);
  const startStep = Math.max(Math.round(startMm * 10), floorStep);

  // Stage 1: One line with a small shrink (start down to oneLineFloor in 0.1 mm steps)
  for (let step = startStep; step >= floorStep; step--) {
    const sMm = step / 10;
    const w = measure(text, sMm, font);
    if (w <= boxWidthMm) {
      return { lines: [text], sizeMm: sMm, status: "ok" };
    }
  }

  // Stage 2: Split / wrap at spaces (start down to min size in 0.1 mm steps)
  for (let step = startStep; step >= minStep; step--) {
    const sMm = step / 10;
    const lines = wrap(text, boxWidthMm, sMm, font, false);
    const widest = Math.max(...lines.map((l) => measure(l, sMm, font)));
    if (lines.length <= maxLines && widest <= boxWidthMm) {
      return { lines, sizeMm: sMm, status: "ok" };
    }
  }

  // Stage 3: Truncate at minimum size with force-break and ellipsis
  const sMm = minStep / 10;
  let lines = wrap(text, boxWidthMm, sMm, font, true);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
  }
  let lastLine = lines[lines.length - 1] || "";
  while (
    lastLine.length > 0 &&
    measure(`${lastLine}...`, sMm, font) > boxWidthMm
  ) {
    lastLine = lastLine.slice(0, -1).trimEnd();
  }
  lines[lines.length - 1] = `${lastLine}...`;

  return { lines, sizeMm: sMm, status: "truncated" };
}
