// @ts-check
import { describe, it, expect } from "vitest";
import {
  parseExportSettings,
  ExportSettingsError,
  sheetLayout,
  SheetLayoutError,
} from "./index.js";

describe("Task E1: Export settings schema and print-sheet layout", () => {
  describe("1. ExportSettings schema and parseExportSettings", () => {
    it("applies standard defaults on empty input", () => {
      const settings = parseExportSettings({});
      expect(settings.format).toBe("pdf");
      expect(settings.mode).toBe("sheets");
      expect(settings.card).toEqual({ widthMm: 54, heightMm: 85.6 });
      expect(settings.orientation).toBe("portrait");
      expect(settings.dpi).toBe(300);
      expect(settings.bleedMm).toBe(3);
      expect(settings.cropMarks).toBe(true); // default true for sheets mode
      expect(settings.sides).toBe("front");
      expect(settings.textAsOutlines).toBe(true);
      expect(settings.groupByRole).toBe(false);
      expect(settings.sheet.paper).toBe("A4");
      expect(settings.sheet.widthMm).toBe(210);
      expect(settings.sheet.heightMm).toBe(297);
      expect(settings.sheet.marginMm).toBe(5);
      expect(settings.sheet.gapMm).toBe(4);
      expect(settings.sheet.markLengthMm).toBe(2);
      expect(settings.sheet.markOffsetMm).toBe(3);
      expect(settings.sheet.markStrokeMm).toBe(0.35);
    });

    it("defaults cropMarks to false when mode is single or all", () => {
      const s1 = parseExportSettings({ mode: "single" });
      expect(s1.cropMarks).toBe(false);

      const s2 = parseExportSettings({ mode: "all" });
      expect(s2.cropMarks).toBe(false);
    });

    it("swaps card dimensions when orientation is landscape", () => {
      const settings = parseExportSettings({
        orientation: "landscape",
        card: { widthMm: 54, heightMm: 85.6 },
      });
      // Landscape ensures width >= height: width becomes 85.6, height becomes 54
      expect(settings.card.widthMm).toBe(85.6);
      expect(settings.card.heightMm).toBe(54);
    });

    it("resolves A3 sheet dimensions correctly", () => {
      const settings = parseExportSettings({ sheet: { paper: "A3" } });
      expect(settings.sheet.widthMm).toBe(297);
      expect(settings.sheet.heightMm).toBe(420);
    });

    it("supports custom sheet paper dimensions", () => {
      const settings = parseExportSettings({
        sheet: { paper: "custom", widthMm: 320, heightMm: 450, marginMm: 10, gapMm: 5 },
      });
      expect(settings.sheet.widthMm).toBe(320);
      expect(settings.sheet.heightMm).toBe(450);
    });

    it("rejects custom paper without dimensions", () => {
      expect(() => parseExportSettings({ sheet: { paper: "custom" } })).toThrowError(ExportSettingsError);
    });

    it("rejects unknown extra keys (strict mode)", () => {
      expect(() => parseExportSettings({ unknownKey: 123 })).toThrowError(ExportSettingsError);
      expect(() => parseExportSettings({ card: { widthMm: 54, heightMm: 85.6, foo: "bar" } })).toThrowError(ExportSettingsError);
      expect(() => parseExportSettings({ sheet: { paper: "A4", extraField: true } })).toThrowError(ExportSettingsError);
    });

    it("rejects NaN, Infinity, negative, and zero values", () => {
      expect(() => parseExportSettings({ dpi: NaN })).toThrowError(ExportSettingsError);
      expect(() => parseExportSettings({ dpi: Infinity })).toThrowError(ExportSettingsError);
      expect(() => parseExportSettings({ bleedMm: -1 })).toThrowError(ExportSettingsError);
      expect(() => parseExportSettings({ bleedMm: 15 })).toThrowError(ExportSettingsError);
      expect(() => parseExportSettings({ card: { widthMm: 0, heightMm: 85.6 } })).toThrowError(ExportSettingsError);
      expect(() => parseExportSettings({ card: { widthMm: -54, heightMm: 85.6 } })).toThrowError(ExportSettingsError);
      expect(() => parseExportSettings({ sheet: { paper: "A4", marginMm: -5 } })).toThrowError(ExportSettingsError);
      expect(() => parseExportSettings({ sheet: { paper: "A4", markStrokeMm: 0.1 } })).toThrowError(ExportSettingsError); // min 0.3mm
    });

    it("rejects unknown enum values", () => {
      // @ts-expect-error
      expect(() => parseExportSettings({ format: "bmp" })).toThrowError(ExportSettingsError);
      // @ts-expect-error
      expect(() => parseExportSettings({ mode: "everything" })).toThrowError(ExportSettingsError);
      // @ts-expect-error
      expect(() => parseExportSettings({ orientation: "diagonal" })).toThrowError(ExportSettingsError);
      // @ts-expect-error
      expect(() => parseExportSettings({ sides: "triple" })).toThrowError(ExportSettingsError);
      // @ts-expect-error
      expect(() => parseExportSettings({ sheet: { paper: "B5" } })).toThrowError(ExportSettingsError);
    });
  });

  describe("2. sheetLayout Pure Imposition Math", () => {
    // Arithmetic comment for default A4 portrait CR80:
    // A4 sheet = 210 x 297 mm.
    // Portrait CR80 card = 54 x 85.6 mm.
    // Bleed = 3 mm -> cellW = 54 + 2*3 = 60 mm, cellH = 85.6 + 2*3 = 91.6 mm.
    // Defaults: margin = 5 mm, gap = 4 mm.
    // cols = floor((210 - 2*5 + 4) / (60 + 4)) = floor(204 / 64) = 3.
    // rows = floor((297 - 2*5 + 4) / (91.6 + 4)) = floor(291 / 95.6) = 3.
    // perPage = cols * rows = 3 * 3 = 9 cards per page.
    it("defaults produce expected portrait CR80 on A4 count: 9 cards per page (3 cols x 3 rows)", () => {
      const cards = Array.from({ length: 9 }, (_, i) => ({ id: `card-${i + 1}` }));
      const result = sheetLayout({}, cards);

      expect(result.cols).toBe(3);
      expect(result.rows).toBe(3);
      expect(result.perPage).toBe(9);
      expect(result.pages.length).toBe(1);
      expect(result.pages[0].cells.length).toBe(9);

      // Verify trim and bleed dimensions for every cell
      for (const cell of result.pages[0].cells) {
        expect(cell.trimBox.w).toBe(54);
        expect(cell.trimBox.h).toBe(85.6);
        expect(cell.bleedBox.w).toBe(60);
        expect(cell.bleedBox.h).toBe(91.6);
        // Trim box is inset by bleed (3mm) inside bleed box
        expect(cell.trimBox.x).toBeCloseTo(cell.bleedBox.x + 3, 3);
        expect(cell.trimBox.y).toBeCloseTo(cell.bleedBox.y + 3, 3);
      }
    });

    it("landscape orientation produces 8 cards per page on A4 (2 cols x 4 rows)", () => {
      // Landscape CR80 = 85.6 wide x 54 tall.
      // With bleed 3: cellW = 91.6, cellH = 60.
      // cols = floor((210 - 2*5 + 4) / (91.6 + 4)) = floor(204 / 95.6) = 2.
      // rows = floor((297 - 2*5 + 4) / (60 + 4)) = floor(291 / 64) = 4.
      // perPage = 2 * 4 = 8 cards per page.
      const cards = Array.from({ length: 8 }, (_, i) => ({ id: `card-${i + 1}` }));
      const result = sheetLayout({ orientation: "landscape" }, cards);

      expect(result.cols).toBe(2);
      expect(result.rows).toBe(4);
      expect(result.perPage).toBe(8);
      expect(result.pages[0].cells.length).toBe(8);
    });

    it("handles bleed 0 and bleed 10 correctly", () => {
      const cards = [{ id: "c1" }];

      // Bleed 0: cell equals trim
      const r0 = sheetLayout({ bleedMm: 0 }, cards);
      const cell0 = r0.pages[0].cells[0];
      expect(cell0.bleedBox.w).toBe(54);
      expect(cell0.bleedBox.h).toBe(85.6);
      expect(cell0.trimBox.x).toBe(cell0.bleedBox.x);
      expect(cell0.trimBox.y).toBe(cell0.bleedBox.y);

      // Bleed 10: cell becomes 74 x 105.6
      const r10 = sheetLayout({ bleedMm: 10, sheet: { paper: "A4", marginMm: 5, gapMm: 4 } }, cards);
      const cell10 = r10.pages[0].cells[0];
      expect(cell10.bleedBox.w).toBe(74);
      expect(cell10.bleedBox.h).toBe(105.6);
    });

    it("handles margin 0 and large gaps", () => {
      const cards = Array.from({ length: 4 }, (_, i) => ({ id: `c-${i}` }));
      const result = sheetLayout({ sheet: { paper: "A4", marginMm: 0, gapMm: 20 } }, cards);
      expect(result.pages.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings.length).toBe(0);
    });

    it("calculates exact page counts for 1, perPage, perPage+1, and 235 cards", () => {
      // perPage = 9
      const res1 = sheetLayout({}, [{ id: "c1" }]);
      expect(res1.pages.length).toBe(1);
      expect(res1.pages[0].cells.length).toBe(1);

      const res9 = sheetLayout({}, Array.from({ length: 9 }, (_, i) => ({ id: `c-${i}` })));
      expect(res9.pages.length).toBe(1);
      expect(res9.pages[0].cells.length).toBe(9);

      const res10 = sheetLayout({}, Array.from({ length: 10 }, (_, i) => ({ id: `c-${i}` })));
      expect(res10.pages.length).toBe(2);
      expect(res10.pages[0].cells.length).toBe(9);
      expect(res10.pages[1].cells.length).toBe(1);

      // 235 cards with perPage = 9: ceil(235 / 9) = 27 pages (26 full pages + 1 page with 1 card)
      const cards235 = Array.from({ length: 235 }, (_, i) => ({ id: `c-${i}` }));
      const res235 = sheetLayout({}, cards235);
      expect(res235.pages.length).toBe(27);
      expect(res235.pages[25].cells.length).toBe(9);
      expect(res235.pages[26].cells.length).toBe(1);
    });

    it("groups by role correctly when groupByRole is true vs false", () => {
      const cards = [
        { id: "org-1", role: "organizer" },
        { id: "org-2", role: "organizer" },
        { id: "part-1", role: "participant" },
        { id: "part-2", role: "participant" },
        { id: "part-3", role: "participant" },
      ];

      // With groupByRole = true: 2 organizers on page 1, 3 participants on page 2 (never mix)
      const resGrouped = sheetLayout({ groupByRole: true }, cards);
      expect(resGrouped.pages.length).toBe(2);
      expect(resGrouped.pages[0].cells.map((c) => c.cardId)).toEqual(["org-1", "org-2"]);
      expect(resGrouped.pages[1].cells.map((c) => c.cardId)).toEqual(["part-1", "part-2", "part-3"]);

      // With groupByRole = false: all 5 cards fit on page 1 in sequential order
      const resUngrouped = sheetLayout({ groupByRole: false }, cards);
      expect(resUngrouped.pages.length).toBe(1);
      expect(resUngrouped.pages[0].cells.length).toBe(5);
      expect(resUngrouped.pages[0].cells.map((c) => c.cardId)).toEqual([
        "org-1",
        "org-2",
        "part-1",
        "part-2",
        "part-3",
      ]);
    });

    it("handles duplex printing: mirrors column order for every back page", () => {
      const cards = Array.from({ length: 4 }, (_, i) => ({ id: `c-${i + 1}` }));
      // 3 cols x 3 rows grid
      const result = sheetLayout({ sides: "both" }, cards);

      // sides = "both" doubles page count (1 front + 1 back = 2 pages)
      expect(result.pages.length).toBe(2);
      expect(result.pages[0].side).toBe("front");
      expect(result.pages[1].side).toBe("back");

      const frontCells = result.pages[0].cells;
      const backCells = result.pages[1].cells;
      expect(frontCells.length).toBe(4);
      expect(backCells.length).toBe(4);

      // Verify that for each card at row r and col c on front,
      // the corresponding back cell is at row r and col (cols - 1 - c).
      const cols = result.cols; // 3
      for (let i = 0; i < 4; i++) {
        const fc = frontCells[i];
        const bc = backCells[i];
        expect(fc.cardId).toBe(bc.cardId);

        // Same row: y positions match
        expect(fc.trimBox.y).toBeCloseTo(bc.trimBox.y, 4);

        // Mirrored column:
        // Col 0 on front (left) mirrors to Col 2 on back (right).
        // Distance from left edge of front cell equals distance from right edge of back cell.
        const cFront = i % cols;
        const cBack = cols - 1 - cFront;

        // Front cell x offset from origin
        const colPitch = fc.bleedBox.w + result.pages[0].widthMm; // pitch formula check
        // Check actual mirroring
        if (cFront === 0) {
          expect(cBack).toBe(2);
          expect(bc.trimBox.x).toBeGreaterThan(fc.trimBox.x);
        } else if (cFront === 1) {
          expect(cBack).toBe(1);
          expect(bc.trimBox.x).toBeCloseTo(fc.trimBox.x, 4);
        }
      }
    });

    it("generates crop marks that lie strictly outside trim and bleed, inside sheet margins, with stroke >= 0.3mm", () => {
      const cards = Array.from({ length: 9 }, (_, i) => ({ id: `c-${i}` }));
      const result = sheetLayout({ cropMarks: true }, cards);
      const page = result.pages[0];

      expect(page.marks.length).toBeGreaterThan(0);

      for (const mark of page.marks) {
        // 1. Stroke is print-safe (>= 0.3mm)
        expect(mark.strokeMm).toBeGreaterThanOrEqual(0.3);

        // 2. Mark coordinates are inside the sheet
        expect(mark.x1).toBeGreaterThanOrEqual(0);
        expect(mark.x1).toBeLessThanOrEqual(page.widthMm);
        expect(mark.y1).toBeGreaterThanOrEqual(0);
        expect(mark.y1).toBeLessThanOrEqual(page.heightMm);
        expect(mark.x2).toBeGreaterThanOrEqual(0);
        expect(mark.x2).toBeLessThanOrEqual(page.widthMm);
        expect(mark.y2).toBeGreaterThanOrEqual(0);
        expect(mark.y2).toBeLessThanOrEqual(page.heightMm);

        // 3. Mark never penetrates ANY cell's trim box or bleed box interior
        const mXmin = Math.min(mark.x1, mark.x2);
        const mXmax = Math.max(mark.x1, mark.x2);
        const mYmin = Math.min(mark.y1, mark.y2);
        const mYmax = Math.max(mark.y1, mark.y2);

        for (const cell of page.cells) {
          // Inside trim box test
          const tXmin = cell.trimBox.x;
          const tXmax = cell.trimBox.x + cell.trimBox.w;
          const tYmin = cell.trimBox.y;
          const tYmax = cell.trimBox.y + cell.trimBox.h;

          const insideTrim = mXmin < tXmax && mXmax > tXmin && mYmin < tYmax && mYmax > tYmin;
          expect(insideTrim).toBe(false);

          // Inside bleed box test (with small epsilon)
          const bXmin = cell.bleedBox.x + 0.001;
          const bXmax = cell.bleedBox.x + cell.bleedBox.w - 0.001;
          const bYmin = cell.bleedBox.y + 0.001;
          const bYmax = cell.bleedBox.y + cell.bleedBox.h - 0.001;

          const insideBleed = mXmin < bXmax && mXmax > bXmin && mYmin < bYmax && mYmax > bYmin;
          expect(insideBleed).toBe(false);
        }
      }
    });

    // duplexFlip comment:
    // - "long": Flipped along the vertical long edge (book binding). Left and right swap,
    //   so columns are mirrored: colBack = cols - 1 - colFront, rowBack = rowFront.
    // - "short": Flipped along the horizontal short edge (calendar binding). Top and bottom swap,
    //   so rows are mirrored: rowBack = rows - 1 - rowFront, colBack = colFront.
    it("duplexFlip: 'long' mirrors columns; 'short' mirrors rows", () => {
      const cards = [
        { id: "A", role: "Organizer" },
        { id: "B", role: "Participant" },
        { id: "C", role: "Mentor" },
        { id: "D", role: "Volunteer" },
      ];

      // 1. "long" flip (default): mirrors columns across vertical axis
      const resLong = sheetLayout({ sides: "both", duplexFlip: "long" }, cards);
      expect(resLong.pages.length).toBe(2);
      const [frontLong, backLong] = resLong.pages;
      const cols = resLong.cols; // 3
      const rows = resLong.rows; // 3

      for (let i = 0; i < cards.length; i++) {
        const fc = frontLong.cells[i];
        const bc = backLong.cells[i];
        expect(fc.cardId).toBe(bc.cardId);

        // Same row: y positions match
        expect(bc.trimBox.y).toBeCloseTo(fc.trimBox.y, 4);

        // Mirrored column:
        const cFront = i % cols;
        const cBack = cols - 1 - cFront;
        const frontLeftDist = fc.trimBox.x;
        const backRightDist = frontLong.widthMm - (bc.trimBox.x + fc.trimBox.w);
        expect(backRightDist).toBeCloseTo(frontLeftDist, 3);
      }

      // 2. "short" flip: mirrors rows across horizontal axis
      const resShort = sheetLayout({ sides: "both", duplexFlip: "short" }, cards);
      expect(resShort.pages.length).toBe(2);
      const [frontShort, backShort] = resShort.pages;

      for (let i = 0; i < cards.length; i++) {
        const fc = frontShort.cells[i];
        const bc = backShort.cells[i];
        expect(fc.cardId).toBe(bc.cardId);

        // Same column: x positions match
        expect(bc.trimBox.x).toBeCloseTo(fc.trimBox.x, 4);

        // Mirrored row:
        // Distance from top paper edge on front MUST equal distance from bottom paper edge on back
        const frontTopDist = fc.trimBox.y;
        const backBottomDist = frontShort.heightMm - (bc.trimBox.y + fc.trimBox.h);
        expect(backBottomDist).toBeCloseTo(frontTopDist, 3);
      }
    });

    it("printerSafeMm: calculates smallest edge distance (5.1mm on default A4) and warns when closer than printerSafeMm", () => {
      const cards = Array.from({ length: 9 }, (_, i) => ({ id: `card-${i + 1}` }));

      // Default A4 portrait layout with printerSafeMm = 5 (default):
      // - Sheet: 210 x 297 mm
      // - Grid height: 282.8 mm -> vertical originY = (297 - 282.8)/2 = 7.1 mm
      // - Top trim box: y = 7.1 + 3 = 10.1 mm
      // - Top crop marks: start at y = 10.1 - 3 = 7.1 mm, end at y = 7.1 - 2 = 5.1 mm
      // - Smallest distance to page edge is exactly 5.1 mm.
      // With printerSafeMm = 5: 5.1mm >= 5.0mm -> SAFE, no warning.
      const defaultResult = sheetLayout({}, cards);
      expect(defaultResult.warnings.filter((w) => w.code === "MARKS_NEAR_PAGE_EDGE").length).toBe(0);

      // With printerSafeMm = 6: 5.1mm < 6.0mm -> Triggers MARKS_NEAR_PAGE_EDGE warning!
      const warnResult = sheetLayout({ sheet: { paper: "A4", printerSafeMm: 6 } }, cards);
      const edgeWarns = warnResult.warnings.filter((w) => w.code === "MARKS_NEAR_PAGE_EDGE");
      expect(edgeWarns.length).toBe(1);
      expect(edgeWarns[0].message).toContain("5.10mm");
      expect(edgeWarns[0].message).toContain("6mm");

      // Also works when specified at top-level
      const topLevelWarn = sheetLayout({ printerSafeMm: 6 }, cards);
      expect(topLevelWarn.warnings.some((w) => w.code === "MARKS_NEAR_PAGE_EDGE")).toBe(true);
    });

    it("MARK_OFFSET_BELOW_BLEED: warns when markOffsetMm is smaller than bleedMm", () => {
      const cards = [{ id: "c1" }];

      // Safe: markOffsetMm (3) >= bleedMm (3) -> no MARK_OFFSET_BELOW_BLEED warning
      const safe = sheetLayout({
        cropMarks: true,
        bleedMm: 3,
        sheet: { paper: "A4", markOffsetMm: 3 },
      }, cards);
      expect(safe.warnings.filter((w) => w.code === "MARK_OFFSET_BELOW_BLEED").length).toBe(0);

      // Unsafe: markOffsetMm (2) < bleedMm (3) -> triggers MARK_OFFSET_BELOW_BLEED
      const unsafe = sheetLayout({
        cropMarks: true,
        bleedMm: 3,
        sheet: { paper: "A4", markOffsetMm: 2 },
      }, cards);
      const warns = unsafe.warnings.filter((w) => w.code === "MARK_OFFSET_BELOW_BLEED");
      expect(warns.length).toBe(1);
      expect(warns[0].code).toBe("MARK_OFFSET_BELOW_BLEED");
      expect(warns[0].message).toContain("2mm");
      expect(warns[0].message).toContain("3mm");
      expect(warns[0].message).toContain("crop marks start inside the bleed area");
    });

    it("printerSafeMm warning distances: warns when gapMm < 2*(markOffset + markLength - bleed) and reports required distance", () => {
      const cards = [{ id: "c1" }, { id: "c2" }];

      // With bleed = 3, offset = 3, length = 2:
      // minGap = 2 * (3 + 2 - 3) = 4.0 mm.
      // Gap 4.0 mm: safe, no warning.
      const safeResult = sheetLayout({
        cropMarks: true,
        bleedMm: 3,
        sheet: { paper: "A4", marginMm: 5, gapMm: 4, markOffsetMm: 3, markLengthMm: 2 },
      }, cards);
      expect(safeResult.warnings.length).toBe(0);

      // Gap 2.5 mm: too small (< 4.0 mm), triggers GAP_TOO_SMALL_FOR_MARKS warning
      const warnResult = sheetLayout({
        cropMarks: true,
        bleedMm: 3,
        sheet: { paper: "A4", marginMm: 5, gapMm: 2.5, markOffsetMm: 3, markLengthMm: 2 },
      }, cards);
      expect(warnResult.warnings.length).toBe(1);
      expect(warnResult.warnings[0].code).toBe("GAP_TOO_SMALL_FOR_MARKS");
      expect(warnResult.warnings[0].message).toContain("2.5mm");
      expect(warnResult.warnings[0].message).toContain("4mm");
    });

    it("all cell and mark coordinates are pure finite numbers without unit strings", () => {
      const cards = [{ id: "c1" }, { id: "c2" }];
      const result = sheetLayout({}, cards);
      const page = result.pages[0];

      for (const cell of page.cells) {
        expect(typeof cell.xMm).toBe("number");
        expect(typeof cell.yMm).toBe("number");
        expect(Number.isFinite(cell.xMm)).toBe(true);
        expect(Number.isFinite(cell.yMm)).toBe(true);
        expect(typeof cell.trimBox.x).toBe("number");
        expect(typeof cell.trimBox.y).toBe("number");
        expect(typeof cell.trimBox.w).toBe("number");
        expect(typeof cell.trimBox.h).toBe("number");
        expect(typeof cell.bleedBox.x).toBe("number");
        expect(typeof cell.bleedBox.y).toBe("number");
        expect(typeof cell.bleedBox.w).toBe("number");
        expect(typeof cell.bleedBox.h).toBe("number");
      }

      for (const mark of page.marks) {
        expect(typeof mark.x1).toBe("number");
        expect(typeof mark.y1).toBe("number");
        expect(typeof mark.x2).toBe("number");
        expect(typeof mark.y2).toBe("number");
        expect(typeof mark.strokeMm).toBe("number");
      }
    });

    it("is completely deterministic: same input produces identical output", () => {
      const cards = [
        { id: "A", role: "organizer" },
        { id: "B", role: "participant" },
        { id: "C", role: "mentor" },
      ];
      const settings = { groupByRole: true, sides: "both", bleedMm: 3 };

      const run1 = sheetLayout(settings, cards);
      const run2 = sheetLayout(settings, cards);

      expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
    });

    it("throws typed SheetLayoutError on bad inputs", () => {
      // 1. Empty cards list
      expect(() => sheetLayout({}, [])).toThrowError(SheetLayoutError);
      // @ts-expect-error
      expect(() => sheetLayout({}, null)).toThrowError(SheetLayoutError);

      // 2. Card bigger than sheet
      expect(() =>
        sheetLayout(
          {
            card: { widthMm: 300, heightMm: 400 },
            sheet: { paper: "A4" },
          },
          [{ id: "giant-card" }]
        )
      ).toThrowError(SheetLayoutError);

      // 3. Margin too big leaving no room
      expect(() =>
        sheetLayout(
          {
            sheet: { paper: "A4", marginMm: 100 },
          },
          [{ id: "c1" }]
        )
      ).toThrowError(SheetLayoutError);
    });
  });
});
