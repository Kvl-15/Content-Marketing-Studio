// @ts-check
import { describe, it, expect } from "vitest";
import {
  parseExportSettings,
  ExportSettingsError,
  sheetLayout,
} from "./index.js";

describe("core/exportSettings.js unit tests", () => {
  it("rejects NaN values in numerical fields", () => {
    // dpi
    expect(() => parseExportSettings({ dpi: NaN })).toThrowError(ExportSettingsError);
    // bleedMm
    expect(() => parseExportSettings({ bleedMm: NaN })).toThrowError(ExportSettingsError);
    // card dimensions
    expect(() => parseExportSettings({ card: { widthMm: NaN, heightMm: 85.6 } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ card: { widthMm: 54, heightMm: NaN } })).toThrowError(ExportSettingsError);
    // sheet dimensions
    expect(() => parseExportSettings({ sheet: { paper: "A4", marginMm: NaN } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ sheet: { paper: "A4", gapMm: NaN } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ sheet: { paper: "A4", markLengthMm: NaN } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ sheet: { paper: "A4", markOffsetMm: NaN } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ sheet: { paper: "A4", markStrokeMm: NaN } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ sheet: { paper: "A4", printerSafeMm: NaN } })).toThrowError(ExportSettingsError);
  });

  it("rejects Infinity values in numerical fields", () => {
    // dpi
    expect(() => parseExportSettings({ dpi: Infinity })).toThrowError(ExportSettingsError);
    // bleedMm
    expect(() => parseExportSettings({ bleedMm: Infinity })).toThrowError(ExportSettingsError);
    // card dimensions
    expect(() => parseExportSettings({ card: { widthMm: Infinity, heightMm: 85.6 } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ card: { widthMm: 54, heightMm: Infinity } })).toThrowError(ExportSettingsError);
    // sheet dimensions
    expect(() => parseExportSettings({ sheet: { paper: "A4", marginMm: Infinity } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ sheet: { paper: "A4", gapMm: Infinity } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ sheet: { paper: "A4", markStrokeMm: Infinity } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ sheet: { paper: "A4", printerSafeMm: Infinity } })).toThrowError(ExportSettingsError);
  });

  it("rejects negative values and zero sizes where disallowed", () => {
    // bleedMm cannot be negative
    expect(() => parseExportSettings({ bleedMm: -1 })).toThrowError(ExportSettingsError);
    // card widthMm & heightMm must be positive and non-zero
    expect(() => parseExportSettings({ card: { widthMm: -54, heightMm: 85.6 } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ card: { widthMm: 0, heightMm: 85.6 } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ card: { widthMm: 54, heightMm: -85.6 } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ card: { widthMm: 54, heightMm: 0 } })).toThrowError(ExportSettingsError);
    // sheet marginMm and gapMm cannot be negative
    expect(() => parseExportSettings({ sheet: { paper: "A4", marginMm: -1 } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ sheet: { paper: "A4", gapMm: -1 } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ sheet: { paper: "A4", markOffsetMm: -1 } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ sheet: { paper: "A4", markLengthMm: 0 } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ sheet: { paper: "A4", markStrokeMm: 0.1 } })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ sheet: { paper: "A4", printerSafeMm: -0.5 } })).toThrowError(ExportSettingsError);
  });

  it("rejects unknown extra keys (strict schema enforcement)", () => {
    // Root level extra key
    expect(() => parseExportSettings({ unexpectedKey: "disallowed" })).toThrowError(ExportSettingsError);
    // Card extra key
    expect(() => parseExportSettings({ card: { widthMm: 54, heightMm: 85.6, color: "blue" } })).toThrowError(ExportSettingsError);
    // Sheet extra key
    expect(() => parseExportSettings({ sheet: { paper: "A4", unknownOption: 123 } })).toThrowError(ExportSettingsError);
  });

  it("rejects unknown paper and format enum values", () => {
    // Unknown paper
    // @ts-expect-error
    expect(() => parseExportSettings({ sheet: { paper: "B5" } })).toThrowError(ExportSettingsError);
    // @ts-expect-error
    expect(() => parseExportSettings({ sheet: { paper: "Letter" } })).toThrowError(ExportSettingsError);
    // Unknown format
    // @ts-expect-error
    expect(() => parseExportSettings({ format: "bmp" })).toThrowError(ExportSettingsError);
    // @ts-expect-error
    expect(() => parseExportSettings({ format: "tiff" })).toThrowError(ExportSettingsError);
    // Unknown mode
    // @ts-expect-error
    expect(() => parseExportSettings({ mode: "batch" })).toThrowError(ExportSettingsError);
    // Unknown orientation
    // @ts-expect-error
    expect(() => parseExportSettings({ orientation: "diagonal" })).toThrowError(ExportSettingsError);
    // Unknown duplexFlip
    // @ts-expect-error
    expect(() => parseExportSettings({ duplexFlip: "diagonal" })).toThrowError(ExportSettingsError);
  });

  it("validates dpi boundary: accepts 72 and 1200, rejects 71 and 1201", () => {
    // Accepted boundaries
    const s72 = parseExportSettings({ dpi: 72 });
    expect(s72.dpi).toBe(72);

    const s1200 = parseExportSettings({ dpi: 1200 });
    expect(s1200.dpi).toBe(1200);

    // Rejected below minimum (71 < 72)
    expect(() => parseExportSettings({ dpi: 71 })).toThrowError(ExportSettingsError);

    // Rejected above maximum (1201 > 1200)
    expect(() => parseExportSettings({ dpi: 1201 })).toThrowError(ExportSettingsError);
  });

  it("validates bleedMm boundary: accepts 0 and 10, rejects 11", () => {
    // Accepted boundaries
    const s0 = parseExportSettings({ bleedMm: 0 });
    expect(s0.bleedMm).toBe(0);

    const s10 = parseExportSettings({ bleedMm: 10 });
    expect(s10.bleedMm).toBe(10);

    // Rejected above maximum (11 > 10)
    expect(() => parseExportSettings({ bleedMm: 11 })).toThrowError(ExportSettingsError);
  });

  it("validates printerSafeMm boundary: accepts 0 and 20, rejects -1 and 21", () => {
    const s0 = parseExportSettings({ printerSafeMm: 0 });
    expect(s0.printerSafeMm).toBe(0);

    const s20 = parseExportSettings({ printerSafeMm: 20 });
    expect(s20.printerSafeMm).toBe(20);

    expect(() => parseExportSettings({ printerSafeMm: -1 })).toThrowError(ExportSettingsError);
    expect(() => parseExportSettings({ printerSafeMm: 21 })).toThrowError(ExportSettingsError);
  });

  it("rejects custom paper without dimensions", () => {
    // Missing both widthMm and heightMm
    expect(() => parseExportSettings({ sheet: { paper: "custom" } })).toThrowError(ExportSettingsError);
    // Missing heightMm
    expect(() => parseExportSettings({ sheet: { paper: "custom", widthMm: 300 } })).toThrowError(ExportSettingsError);
    // Missing widthMm
    expect(() => parseExportSettings({ sheet: { paper: "custom", heightMm: 400 } })).toThrowError(ExportSettingsError);
  });

  it("swaps dimensions in landscape orientation", () => {
    // Input is portrait card: 54 wide x 85.6 tall
    const settings = parseExportSettings({
      orientation: "landscape",
      card: { widthMm: 54, heightMm: 85.6 },
    });
    // In landscape orientation, width >= height: width becomes 85.6, height becomes 54
    expect(settings.card.widthMm).toBe(85.6);
    expect(settings.card.heightMm).toBe(54);

    // If input is already landscape (85.6 wide x 54 tall), stays 85.6 x 54
    const s2 = parseExportSettings({
      orientation: "landscape",
      card: { widthMm: 85.6, heightMm: 54 },
    });
    expect(s2.card.widthMm).toBe(85.6);
    expect(s2.card.heightMm).toBe(54);
  });

  // A3 sheet layout test with arithmetic derivation in comment:
  // - Sheet: A3 portrait = 297 mm wide x 420 mm tall.
  // - Card: portrait CR80 = 54 mm wide x 85.6 mm tall.
  // - Bleed: 3 mm -> cellW = 54 + 2*3 = 60 mm, cellH = 85.6 + 2*3 = 91.6 mm.
  // - Margins: 5 mm default; Gap: 4 mm default.
  // - Available printable width = 297 - 2*5 = 287 mm.
  //   cols = floor((297 - 2*5 + 4) / (60 + 4)) = floor(291 / 64) = 4 columns.
  //   Width used = 4 * 60 + 3 * 4 = 240 + 12 = 252 mm <= 287 mm (fits with 45 mm remaining margin).
  // - Available printable height = 420 - 2*5 = 410 mm.
  //   rows = floor((420 - 2*5 + 4) / (91.6 + 4)) = floor(414 / 95.6) = 4 rows.
  //   Height used = 4 * 91.6 + 3 * 4 = 366.4 + 12 = 378.4 mm <= 410 mm (fits with 41.6 mm remaining margin).
  // - Cards per A3 sheet: perPage = cols * rows = 4 * 4 = 16 cards per page.
  it("A3 layout test: places 16 portrait CR80 cards per page (4 cols x 4 rows)", () => {
    const cards = Array.from({ length: 16 }, (_, i) => ({ id: `card-a3-${i + 1}` }));
    const result = sheetLayout({ sheet: { paper: "A3" } }, cards);

    expect(result.cols).toBe(4);
    expect(result.rows).toBe(4);
    expect(result.perPage).toBe(16);
    expect(result.pages.length).toBe(1);
    expect(result.pages[0].cells.length).toBe(16);

    // Verify cell dimensions and bleed insets
    for (const cell of result.pages[0].cells) {
      expect(cell.trimBox.w).toBe(54);
      expect(cell.trimBox.h).toBe(85.6);
      expect(cell.bleedBox.w).toBe(60);
      expect(cell.bleedBox.h).toBe(91.6);
      expect(cell.trimBox.x).toBeCloseTo(cell.bleedBox.x + 3, 3);
      expect(cell.trimBox.y).toBeCloseTo(cell.bleedBox.y + 3, 3);
    }
  });
});
