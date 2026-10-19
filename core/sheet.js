// @ts-check
import { parseExportSettings } from "./exportSettings.js";

/**
 * Typed error thrown when sheet imposition fails.
 */
export class SheetLayoutError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   */
  constructor(message, code = "INVALID_SHEET_LAYOUT") {
    super(message);
    this.name = "SheetLayoutError";
    this.code = code;
  }
}

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} BoxMm
 * @typedef {{ cardId: string, xMm: number, yMm: number, trimBox: BoxMm, bleedBox: BoxMm }} SheetCell
 * @typedef {{ x1: number, y1: number, x2: number, y2: number, strokeMm: number }} CropMark
 * @typedef {{ pageIndex: number, side: "front" | "back", widthMm: number, heightMm: number, cells: SheetCell[], marks: CropMark[] }} SheetPage
 * @typedef {{ pages: SheetPage[], perPage: number, cols: number, rows: number, warnings: Array<{ code: string, message: string }> }} SheetLayoutResult
 */

/**
 * Pure calculation that arranges cards onto print sheets (A4/A3/custom)
 * with bleed, crop marks, duplex mirroring, and role grouping.
 *
 * Follows KB 13.3 imposition formulas:
 *   cell = trim + 2 * bleed
 *   cols = floor((sheetW - 2 * margin + gap) / (cellW + gap))
 *   rows = floor((sheetH - 2 * margin + gap) / (cellH + gap))
 *
 * @param {import("./exportSettings.js").ExportSettings | Record<string, any>} rawSettings - Raw or parsed settings.
 * @param {Array<{ id: string, role?: string }>} cards - List of cards to place.
 * @returns {SheetLayoutResult}
 * @throws {SheetLayoutError}
 */
export function sheetLayout(rawSettings, cards) {
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new SheetLayoutError("Card list cannot be empty", "EMPTY_CARD_LIST");
  }

  // Ensure settings are validated and normalized
  const settings = parseExportSettings(rawSettings);

  const cardW = settings.card.widthMm;
  const cardH = settings.card.heightMm;
  const bleed = settings.bleedMm;

  if (cardW <= 0 || cardH <= 0 || !Number.isFinite(cardW) || !Number.isFinite(cardH)) {
    throw new SheetLayoutError("Card dimensions must be finite positive numbers", "INVALID_DIMENSIONS");
  }

  const cellW = cardW + 2 * bleed;
  const cellH = cardH + 2 * bleed;

  const sheetW = settings.sheet.widthMm;
  const sheetH = settings.sheet.heightMm;
  const margin = settings.sheet.marginMm;
  const gap = settings.sheet.gapMm;

  const printW = sheetW - 2 * margin;
  const printH = sheetH - 2 * margin;

  if (cellW > printW || cellH > printH) {
    throw new SheetLayoutError(
      `Card with bleed (${cellW.toFixed(1)}x${cellH.toFixed(1)}mm) exceeds printable sheet area (${printW.toFixed(1)}x${printH.toFixed(1)}mm)`,
      "CARD_EXCEEDS_SHEET"
    );
  }

  const cols = Math.floor((sheetW - 2 * margin + gap) / (cellW + gap));
  const rows = Math.floor((sheetH - 2 * margin + gap) / (cellH + gap));

  if (cols < 1 || rows < 1) {
    throw new SheetLayoutError("No cards fit on sheet with given margin and gap", "CARD_EXCEEDS_SHEET");
  }

  const perPage = cols * rows;

  /** @type {Array<{ code: string, message: string }>} */
  const warnings = [];

  // Warning if markOffsetMm < bleedMm: marks would start inside the bleed area
  if (settings.cropMarks && settings.sheet.markOffsetMm < bleed) {
    warnings.push({
      code: "MARK_OFFSET_BELOW_BLEED",
      message: `markOffsetMm (${settings.sheet.markOffsetMm}mm) is smaller than bleedMm (${bleed}mm); crop marks start inside the bleed area`,
    });
  }

  // Check gap adequacy for crop marks
  // Note: The gap formula is conservative: minGapForMarks = 2 * (markOffsetMm + markLengthMm - bleed).
  // It assumes crop marks from adjacent cards extend towards each other and ensures they do not overlap
  // or penetrate opposing bleed boxes.
  if (settings.cropMarks && (cols > 1 || rows > 1)) {
    const minGapForMarks = Math.max(0, 2 * (settings.sheet.markOffsetMm + settings.sheet.markLengthMm - bleed));
    if (gap < minGapForMarks) {
      warnings.push({
        code: "GAP_TOO_SMALL_FOR_MARKS",
        message: `gapMm (${gap}mm) is smaller than recommended minimum (${minGapForMarks}mm) to fit crop marks between cards without collision`,
      });
    }
  }

  // Centering calculations
  const usedW = cols * cellW + (cols - 1) * gap;
  const usedH = rows * cellH + (rows - 1) * gap;
  const originX = (sheetW - usedW) / 2;
  const originY = (sheetH - usedH) / 2;

  // Group cards if requested
  /** @type {Array<Array<{ id: string, role?: string }>>} */
  const chunks = [];

  if (settings.groupByRole) {
    /** @type {Map<string, Array<{ id: string, role?: string }>>} */
    const roleGroups = new Map();
    for (const card of cards) {
      const role = card.role || "default";
      if (!roleGroups.has(role)) roleGroups.set(role, []);
      /** @type {Array<{ id: string, role?: string }>} */ (roleGroups.get(role)).push(card);
    }

    for (const group of roleGroups.values()) {
      for (let i = 0; i < group.length; i += perPage) {
        chunks.push(group.slice(i, i + perPage));
      }
    }
  } else {
    for (let i = 0; i < cards.length; i += perPage) {
      chunks.push(cards.slice(i, i + perPage));
    }
  }

  /**
   * Helper to build cells for a chunk on front or mirrored back.
   *
   * Duplex flipping semantics:
   * - "long" (default): Used for standard book/portrait binding or duplexing along the long edge.
   *   Flipping along the vertical long edge swaps Left and Right, so columns are mirrored:
   *   actualCol = cols - 1 - c, actualRow = r.
   * - "short": Used for wall calendars, top-bound notepads, or duplexing along the short edge.
   *   Flipping along the horizontal short edge swaps Top and Bottom, so rows are mirrored:
   *   actualCol = c, actualRow = rows - 1 - r.
   *
   * @param {Array<{ id: string, role?: string }>} cardChunk
   * @param {"front" | "back"} side
   * @returns {SheetCell[]}
   */
  function buildCells(cardChunk, side) {
    /** @type {SheetCell[]} */
    const cells = [];
    for (let i = 0; i < cardChunk.length; i++) {
      const card = cardChunk[i];
      const r = Math.floor(i / cols);
      const c = i % cols;
      let actualCol = c;
      let actualRow = r;

      if (side === "back") {
        if (settings.duplexFlip === "short") {
          actualRow = rows - 1 - r;
        } else {
          // "long" edge flip (default): mirrors columns
          actualCol = cols - 1 - c;
        }
      }

      const bleedX = originX + actualCol * (cellW + gap);
      const bleedY = originY + actualRow * (cellH + gap);
      const trimX = bleedX + bleed;
      const trimY = bleedY + bleed;

      cells.push({
        cardId: card.id,
        xMm: Number(trimX.toFixed(4)),
        yMm: Number(trimY.toFixed(4)),
        trimBox: {
          x: Number(trimX.toFixed(4)),
          y: Number(trimY.toFixed(4)),
          w: Number(cardW.toFixed(4)),
          h: Number(cardH.toFixed(4)),
        },
        bleedBox: {
          x: Number(bleedX.toFixed(4)),
          y: Number(bleedY.toFixed(4)),
          w: Number(cellW.toFixed(4)),
          h: Number(cellH.toFixed(4)),
        },
      });
    }
    return cells;
  }

  /**
   * Generates vector crop marks for a list of cells on a sheet.
   * Marks lie outside trim and bleed, never entering any card's bleed box,
   * clamped to stay within the sheet margins and between cards.
   *
   * @param {SheetCell[]} cells
   * @returns {CropMark[]}
   */
  function generateMarks(cells) {
    if (!settings.cropMarks || cells.length === 0) return [];

    const offset = settings.sheet.markOffsetMm;
    const len = settings.sheet.markLengthMm;
    const stroke = settings.sheet.markStrokeMm;

    /** @type {Map<string, CropMark>} */
    const markMap = new Map();

    /**
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     */
    function addMark(x1, y1, x2, y2) {
      // Round to 4 decimals for clean equality and SVG emission
      const rx1 = Math.max(0, Math.min(sheetW, Number(x1.toFixed(4))));
      const ry1 = Math.max(0, Math.min(sheetH, Number(y1.toFixed(4))));
      const rx2 = Math.max(0, Math.min(sheetW, Number(x2.toFixed(4))));
      const ry2 = Math.max(0, Math.min(sheetH, Number(y2.toFixed(4))));

      // Skip degenerate 0-length marks
      if (Math.abs(rx1 - rx2) < 0.001 && Math.abs(ry1 - ry2) < 0.001) return;

      // Canonical key to prevent duplicates
      const key = `${Math.min(rx1, rx2)},${Math.min(ry1, ry2)}-${Math.max(rx1, rx2)},${Math.max(ry1, ry2)}`;
      if (!markMap.has(key)) {
        markMap.set(key, { x1: rx1, y1: ry1, x2: rx2, y2: ry2, strokeMm: stroke });
      }
    }

    for (const cell of cells) {
      const { trimBox, bleedBox } = cell;
      const xL = trimBox.x;
      const xR = trimBox.x + trimBox.w;
      const yT = trimBox.y;
      const yB = trimBox.y + trimBox.h;

      // Distance from trim to bleed edge is `bleed`
      // Offset from trim is `offset` (>= bleed)
      // Top marks (pointing UP)
      const topStart = yT - offset;
      const topEnd = topStart - len;
      // Clamp to stay outside any bleed box above (topStart is at or above bleedBox.y)
      addMark(xL, topStart, xL, topEnd);
      addMark(xR, topStart, xR, topEnd);

      // Bottom marks (pointing DOWN)
      const bottomStart = yB + offset;
      const bottomEnd = bottomStart + len;
      addMark(xL, bottomStart, xL, bottomEnd);
      addMark(xR, bottomStart, xR, bottomEnd);

      // Left marks (pointing LEFT)
      const leftStart = xL - offset;
      const leftEnd = leftStart - len;
      addMark(leftStart, yT, leftEnd, yT);
      addMark(leftStart, yB, leftEnd, yB);

      // Right marks (pointing RIGHT)
      const rightStart = xR + offset;
      const rightEnd = rightStart + len;
      addMark(rightStart, yT, rightEnd, yT);
      addMark(rightStart, yB, rightEnd, yB);
    }

    // Filter marks so NO mark ever penetrates ANY cell's bleed box
    const filteredMarks = [];
    for (const mark of markMap.values()) {
      let intersectsBleed = false;
      const mxMin = Math.min(mark.x1, mark.x2);
      const mxMax = Math.max(mark.x1, mark.x2);
      const myMin = Math.min(mark.y1, mark.y2);
      const myMax = Math.max(mark.y1, mark.y2);

      for (const cell of cells) {
        const { bleedBox } = cell;
        const bxMin = bleedBox.x + 0.001; // small epsilon for boundary touching
        const bxMax = bleedBox.x + bleedBox.w - 0.001;
        const byMin = bleedBox.y + 0.001;
        const byMax = bleedBox.y + bleedBox.h - 0.001;

        if (mxMin < bxMax && mxMax > bxMin && myMin < byMax && myMax > byMin) {
          intersectsBleed = true;
          break;
        }
      }

      if (!intersectsBleed) {
        filteredMarks.push(mark);
      }
    }

    return filteredMarks;
  }

  /** @type {SheetPage[]} */
  const pages = [];
  let pageCounter = 0;

  for (const chunk of chunks) {
    if (settings.sides === "front" || settings.sides === "both") {
      const frontCells = buildCells(chunk, "front");
      pages.push({
        pageIndex: pageCounter++,
        side: "front",
        widthMm: sheetW,
        heightMm: sheetH,
        cells: frontCells,
        marks: generateMarks(frontCells),
      });
    }

    if (settings.sides === "back" || settings.sides === "both") {
      const backCells = buildCells(chunk, "back");
      pages.push({
        pageIndex: pageCounter++,
        side: "back",
        widthMm: sheetW,
        heightMm: sheetH,
        cells: backCells,
        marks: generateMarks(backCells),
      });
    }
  }

  // Printer-safe margin check across all pages:
  // Verifies distance from every bleed box and crop mark to every page edge.
  // In the default A4 portrait CR80 layout:
  // - Top and bottom bleed boxes are at y = 7.1mm and y = 289.9mm (distance = 7.1mm).
  // - Top crop marks start at y = 7.1mm and extend to y = 5.1mm (distance to top edge = 5.1mm).
  // - Bottom crop marks start at y = 289.9mm and extend to y = 291.9mm (distance to bottom edge = 5.1mm).
  // Thus, the real smallest distance in the default A4 layout is exactly 5.1mm.
  const printerSafeMm = settings.printerSafeMm ?? settings.sheet.printerSafeMm ?? 5;
  let minEdgeDistance = Infinity;

  for (const page of pages) {
    for (const cell of page.cells) {
      const b = cell.bleedBox;
      const dLeft = b.x;
      const dRight = page.widthMm - (b.x + b.w);
      const dTop = b.y;
      const dBottom = page.heightMm - (b.y + b.h);
      minEdgeDistance = Math.min(minEdgeDistance, dLeft, dRight, dTop, dBottom);
    }
    for (const m of page.marks) {
      const d1Left = m.x1;
      const d1Right = page.widthMm - m.x1;
      const d1Top = m.y1;
      const d1Bottom = page.heightMm - m.y1;
      const d2Left = m.x2;
      const d2Right = page.widthMm - m.x2;
      const d2Top = m.y2;
      const d2Bottom = page.heightMm - m.y2;
      minEdgeDistance = Math.min(
        minEdgeDistance,
        d1Left, d1Right, d1Top, d1Bottom,
        d2Left, d2Right, d2Top, d2Bottom
      );
    }
  }

  if (minEdgeDistance < printerSafeMm) {
    warnings.push({
      code: "MARKS_NEAR_PAGE_EDGE",
      message: `Crop mark or bleed box is ${minEdgeDistance.toFixed(2)}mm from page edge, closer than printerSafeMm (${printerSafeMm}mm)`,
    });
  }

  return {
    pages,
    perPage,
    cols,
    rows,
    warnings,
  };
}
