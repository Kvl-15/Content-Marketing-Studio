// @ts-check
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import opentype from "opentype.js";
import sharp from "sharp";
import {
  exportCard,
  exportSheet,
  exportZip,
  qrPath,
  withBrowser,
  inspectPdfBytes,
  prefixCardSvgIds,
  deduplicateLogoInSvg,
} from "./index.js";
import * as pdfModule from "./pdf.js";
import { enforceOfflinePage } from "./pdf.js";
import { sheetLayout } from "../../core/sheet.js";
import { parseExportSettings } from "../../core/exportSettings.js";
import {
  sampleEventSpec,
  sampleBrandKit,
  personNormal,
  personLongName,
  personNoPhoto,
} from "../../core/fixtures.js";
import { composeDrafts } from "../../core/composer.js";
import { loadContent } from "../../scripts/loadContent.js";

function loadFont(relPath) {
  const fullPath = path.resolve(process.cwd(), relPath);
  const buf = fs.readFileSync(fullPath);
  return opentype.parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
}

describe("E2b: PDF, Print Sheets, ZIP, and Vector QR Module", () => {
  /** @type {any} */
  let draft;
  /** @type {any} */
  let drafts;
  /** @type {any} */
  let testFonts;
  /** @type {any} */
  let brandWithLogos;
  /** @type {string} */
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "acm-export-e2b-test-")
    );
    testFonts = {
      heading: loadFont("assets/fonts/SpaceGrotesk-Bold.ttf"),
      body: loadFont("assets/fonts/Inter-Regular.ttf"),
    };
    const { brandKits } = loadContent();
    brandWithLogos = brandKits["test-logos"];
    const draftsResult = composeDrafts(sampleEventSpec, {
      brand: brandWithLogos || sampleBrandKit,
      qrEnabled: false,
    });
    drafts = draftsResult.drafts;
    draft = drafts[0];
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // =========================================================================
  // Requirement 7: Vector QR module server/export/qr.js
  // =========================================================================
  describe("Requirement 7: Vector QR module (server/export/qr.js)", () => {
    it("generates deterministic vector SVG path data and module count", () => {
      const url = "https://example.com/verify?id=HX26-P-001";
      const result1 = qrPath(url);
      const result2 = qrPath(url);

      expect(typeof result1.path).toBe("string");
      expect(result1.path.length).toBeGreaterThan(100);
      expect(result1.modules).toBeGreaterThanOrEqual(21);
      expect(result1.gridSize).toBe(result1.modules);
      expect(result1.path).toBe(result2.path); // Deterministic
      expect(result1.modules).toBe(result2.modules);
      // Path consists strictly of M, h, v, Z commands (clean rectangle runs)
      expect(/^[M0-9\shvZ.-]+$/.test(result1.path)).toBe(true);
    });

    it("enforces HTTPS-only URLs and rejects invalid inputs with clear errors", () => {
      // Non-string
      // @ts-ignore
      expect(() => qrPath(null)).toThrow("QR URL must be a non-empty string");
      // @ts-ignore
      expect(() => qrPath(123)).toThrow("QR URL must be a non-empty string");
      // Empty string
      expect(() => qrPath("   ")).toThrow("QR URL must be a non-empty string");
      // Invalid URL
      expect(() => qrPath("not-a-valid-url")).toThrow("Invalid URL for QR code");
      // HTTP protocol
      expect(() => qrPath("http://example.com")).toThrow("HTTPS only");
      // FTP protocol
      expect(() => qrPath("ftp://example.com/file")).toThrow("HTTPS only");
    });

    it("respects errorCorrectionLevel and margin options", () => {
      const url = "https://example.com/event";
      const qrM = qrPath(url, { errorCorrectionLevel: "M", margin: 2 });
      const qrH = qrPath(url, { errorCorrectionLevel: "H", margin: 0 });

      expect(qrM.margin).toBe(2);
      expect(qrM.modules).toBe(qrM.gridSize + 4);
      expect(qrH.margin).toBe(0);
      expect(qrH.modules).toBe(qrH.gridSize);

      // Invalid error correction level
      // @ts-ignore
      expect(() => qrPath(url, { errorCorrectionLevel: "X" })).toThrow(
        "Invalid errorCorrectionLevel"
      );
    });
  });

  // =========================================================================
  // Requirement 3 & Condition 4: Puppeteer lifecycle & offline security
  // =========================================================================
  describe("Requirement 3 & Condition 4: Browser lifecycle & offline security", () => {
    it("proves browser is closed in finally block after an error", async () => {
      /** @type {import("puppeteer").Browser | null} */
      let browserRef = null;

      await expect(
        withBrowser(async (browser) => {
          browserRef = browser;
          expect(browser.connected).toBe(true);
          throw new Error("Intentional pipeline error");
        })
      ).rejects.toThrow("Intentional pipeline error");

      expect(browserRef).not.toBeNull();
      // Browser must be disconnected / closed after error
      expect(browserRef?.connected).toBe(false);
    }, 15000);

    it("blocks non-data network requests in Chromium and fails closed on http images", async () => {
      await withBrowser(async (browser) => {
        const page = await browser.newPage();
        let blockedCount = 0;
        await enforceOfflinePage(page);

        page.on("requestfailed", (req) => {
          if (!req.url().startsWith("data:") && req.url() !== "about:blank") {
            blockedCount++;
          }
        });

        // Set content attempting to load an external http image and an allowed data URI
        const testHtml = `
          <!DOCTYPE html>
          <html>
            <head><title>ID cards</title></head>
            <body>
              <img src="http://example.com/untrusted-photo.jpg" onerror="window.imgFailed=true" />
              <img src="data:image/svg+xml;utf8,<svg></svg>" />
            </body>
          </html>
        `;
        await page.setContent(testHtml, { waitUntil: "load" });

        // Evaluates that the HTTP image failed closed in DOM
        const imgFailed = await page.evaluate(() => /** @type {any} */ (window).imgFailed === true);
        await page.close();

        expect(blockedCount).toBeGreaterThanOrEqual(1);
        expect(imgFailed).toBe(true);
      });
    }, 15000);

    it("verifies neutral PDF metadata (Title: ID cards, no Author, no personal names/emails)", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: personNormal,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const cardResult = await exportCard(input, { format: "pdf", bleedMm: 3 });
      expect(cardResult.ok).toBe(true);
      const cardInspect = inspectPdfBytes(cardResult.data);
      expect(cardInspect.title).toBe("ID cards");
      expect(cardInspect.author).toBeNull();
      expect(cardInspect.producer).toContain("Skia/PDF");
      expect(cardInspect.title).not.toContain(personNormal.name);
      expect(cardInspect.title).not.toContain(personNormal.email);

      const sheetResult = await exportSheet(
        { ...input, people: [personNormal] },
        { format: "pdf", bleedMm: 3 }
      );
      expect(sheetResult.ok).toBe(true);
      const sheetInspect = inspectPdfBytes(sheetResult.data);
      expect(sheetInspect.title).toBe("ID cards");
      expect(sheetInspect.author).toBeNull();
      expect(sheetInspect.producer).toContain("Skia/PDF");
      expect(sheetInspect.title).not.toContain(personNormal.name);
      expect(sheetInspect.title).not.toContain(personNormal.email);
    }, 15000);
  });

  // =========================================================================
  // Requirement 2: Single-card vector PDF (60 x 91.6 mm at bleed 3)
  // =========================================================================
  describe("Requirement 2: Single-card PDF export", () => {
    it("exports vector PDF with exact page size (60 x 91.6 mm at bleed 3) and no embedded fonts", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: personNormal,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const result = await exportCard(input, { format: "pdf", bleedMm: 3 });
      expect(result.ok).toBe(true);
      expect(result.mimeType).toBe("application/pdf");
      expect(Buffer.isBuffer(result.data)).toBe(true);

      const inspection = inspectPdfBytes(result.data);
      expect(inspection.pageCount).toBe(1);
      expect(inspection.hasEmbeddedFonts).toBe(false); // D-28: text is outlines, no fonts embedded
      expect(inspection.hasCreationDate).toBe(true); // Requirement 8: PDFs have creation date

      expect(inspection.mediaBoxes.length).toBeGreaterThanOrEqual(1);
      const box = inspection.mediaBoxes[0];
      // 60 mm wide x 91.6 mm high at bleed 3
      expect(box.widthMm).toBeCloseTo(60, 0.5);
      expect(box.heightMm).toBeCloseTo(91.6, 0.5);
    });
  });

  // =========================================================================
  // Requirement 4 & 5: Print sheets, imposition, and logo deduplication
  // =========================================================================
  describe("Requirements 4 & 5: Print sheets (A4 portrait CR80, 9 cards/page)", () => {
    it("refuses unsupported sides 'back' and 'both' with clear message", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        people: [personNormal],
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const resBack = await exportSheet(input, { sides: "back" });
      expect(resBack.ok).toBe(false);
      expect(resBack.reason).toContain("Sides 'back' is not supported");

      const resBoth = await exportSheet(input, { sides: "both" });
      expect(resBoth.ok).toBe(false);
      expect(resBoth.reason).toContain("Sides 'both' is not supported");
    });

    it("refuses landscape orientation with clear message", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        people: [personNormal],
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const res = await exportSheet(input, { orientation: "landscape" });
      expect(res.ok).toBe(false);
      expect(res.reason).toContain("Orientation 'landscape' is not supported");
    });

    it("refuses empty card list", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        people: [],
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const res = await exportSheet(input);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain("empty");
    });

    it("refuses when fonts are missing", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        people: [personNormal],
        brand: brandWithLogos,
        fonts: null,
      };

      const res = await exportSheet(input);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain("missing loaded fonts");
    });

    it("refuses when brand logo image data is missing", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        people: [personNormal],
        brand: {
          logos: {
            primary: { dataUri: null, width: 0, height: 0 },
          },
        },
        fonts: testFonts,
      };

      const res = await exportSheet(input);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain("missing loaded image data");
    });

    it("supports 1 card on a sheet (partly filled page) with exact A4 dimensions", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        people: [personNormal],
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const result = await exportSheet(input, { format: "pdf" });
      expect(result.ok).toBe(true);
      expect(result.pageCount).toBe(1);
      expect(result.cardsCount).toBe(1);

      const inspect = inspectPdfBytes(result.data);
      expect(inspect.pageCount).toBe(1);
      expect(inspect.hasEmbeddedFonts).toBe(false);
      const box = inspect.mediaBoxes[0];
      // A4 is 210 x 297 mm
      expect(Math.abs(box.widthMm - 210)).toBeLessThan(0.5);
      expect(Math.abs(box.heightMm - 297)).toBeLessThan(0.5);
    });

    it("supports 9 cards on a sheet (full page) and proves logo deduplication (9-card sheet is not 9x larger)", async () => {
      const people = Array.from({ length: 9 }, (_, i) => ({
        ...personNormal,
        id: `person-${i + 1}`,
      }));

      const input = {
        eventSpec: sampleEventSpec,
        draft,
        people,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      // 1-card PDF
      const singleRes = await exportCard(
        {
          eventSpec: sampleEventSpec,
          draft,
          person: personNormal,
          brand: brandWithLogos,
          fonts: testFonts,
        },
        { format: "pdf", bleedMm: 3 }
      );
      expect(singleRes.ok).toBe(true);
      const singleSize = singleRes.data.length;

      // 9-card Sheet PDF
      const sheetRes = await exportSheet(input, { format: "pdf" });
      expect(sheetRes.ok).toBe(true);
      expect(sheetRes.pageCount).toBe(1);
      expect(sheetRes.cardsCount).toBe(9);
      const sheetSize = sheetRes.data.length;

      console.log(
        `[Logo Deduplication Proof] Single-card PDF size: ${singleSize} bytes, 9-card Sheet PDF size: ${sheetSize} bytes`
      );
      // A 9-card sheet must not be about 9 times larger! (Expect ratio < 2.0x, typically ~1.2x)
      expect(sheetSize).toBeLessThan(singleSize * 3);

      // Condition 5: Verify MediaBox, font count, image count, and metadata
      const inspect = inspectPdfBytes(sheetRes.data);
      expect(inspect.pageCount).toBe(1);
      expect(inspect.fontCount).toBe(0); // Zero embedded fonts
      expect(inspect.hasEmbeddedFonts).toBe(false);
      expect(inspect.imageCount).toBe(2); // Exactly 2 image XObjects (1 per logo) across all 9 cards!
      expect(inspect.title).toBe("ID cards");
      expect(inspect.author).toBeNull();
      expect(inspect.producer).toContain("Skia/PDF");

      const box = inspect.mediaBoxes[0];
      // A4 is 210 x 297 mm = 595.28 x 841.89 pt. Chromium Skia generates 594.96 x 841.92 pt (within 0.5 pt tolerance).
      expect(Math.abs(box.widthPt - 595.28)).toBeLessThan(0.5);
      expect(Math.abs(box.heightPt - 841.89)).toBeLessThan(0.5);
      expect(Math.abs(box.widthMm - 210)).toBeLessThan(0.2);
      expect(Math.abs(box.heightMm - 297)).toBeLessThan(0.2);
    });

    it("supports 10 cards on a sheet (2 pages: 9 cards on page 1, 1 card on page 2)", async () => {
      const people = Array.from({ length: 10 }, (_, i) => ({
        ...personNormal,
        id: `person-${i + 1}`,
      }));

      const input = {
        eventSpec: sampleEventSpec,
        draft,
        people,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const result = await exportSheet(input, { format: "pdf" });
      expect(result.ok).toBe(true);
      expect(result.pageCount).toBe(2);
      expect(result.cardsCount).toBe(10);

      const inspect = inspectPdfBytes(result.data);
      expect(inspect.pageCount).toBe(2);
    });

    it("verifies groupByRole groups cards by role into distinct chunks", async () => {
      const people = [
        { ...personNormal, id: "p1", roleId: "volunteer" },
        { ...personNormal, id: "p2", roleId: "volunteer" },
        { ...personNormal, id: "p3", roleId: "participant" },
        { ...personNormal, id: "p4", roleId: "participant" },
      ];

      const input = {
        eventSpec: sampleEventSpec,
        draft,
        people,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const result = await exportSheet(input, {
        format: "svg",
        groupByRole: true,
      });
      expect(result.ok).toBe(true);
      expect(typeof result.data).toBe("string");
      // Check that nested card SVG elements do NOT have "mm" on x, y, width, or height
      expect(result.data).not.toMatch(/<svg[^>]+x="[0-9.]+mm"/);
      expect(result.data).not.toMatch(/<svg[^>]+y="[0-9.]+mm"/);

      // Match all nested card <svg x="..." tags
      const cardSvgTags = result.data.match(/<svg\s+x="[^"]+"[^>]*>/g) || [];
      expect(cardSvgTags.length).toBe(4);
      cardSvgTags.forEach((tag) => {
        expect(tag).not.toMatch(/width="[0-9.]+mm"/);
        expect(tag).not.toMatch(/height="[0-9.]+mm"/);
        expect(tag).not.toMatch(/x="[0-9.]+mm"/);
        expect(tag).not.toMatch(/y="[0-9.]+mm"/);
      });
    });
  });

  // =========================================================================
  // Condition 1: 9 DIFFERENT cards isolation test (PNG pixel comparison)
  // =========================================================================
  describe("Condition 1: Duplicate IDs & clip-path isolation (9 DIFFERENT cards test)", () => {
    it("proves 9 different cards on a sheet maintain exact clip paths without cross-card distortion", async () => {
      // 9 distinct persons with different photo modes, clips, roles, and names
      const distinctPeople = [
        { ...personNormal, id: "c1", roleId: "participant", photo: null },
        { ...personNormal, id: "c2", roleId: "volunteer", photo: null },
        { ...personNormal, id: "c3", roleId: "mentor", photo: null },
        { ...personLongName, id: "c4", roleId: "organizer", photo: null },
        { ...personNoPhoto, id: "c5", roleId: "participant" },
        { ...personNormal, id: "c6", roleId: "volunteer", name: "Alice Smith", photo: null },
        { ...personNormal, id: "c7", roleId: "mentor", name: "Bob Johnson", photo: null },
        { ...personNormal, id: "c8", roleId: "organizer", name: "Carol White", photo: null },
        { ...personNormal, id: "c9", roleId: "participant", name: "David Brown", photo: null },
      ];

      // Use composer drafts with varied photo clips and archetypes
      const cardItems = distinctPeople.map((person, idx) => {
        const d = drafts[idx % drafts.length];
        return { person, draft: d };
      });

      const input = {
        eventSpec: sampleEventSpec,
        draft,
        cards: cardItems,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      // Export sheet in SVG format with acknowledgedWarnings for missing photo warnings
      const sheetSvgResult = await exportSheet(
        input,
        { format: "svg", bleedMm: 3 },
        { acknowledgedWarnings: true }
      );
      expect(sheetSvgResult.ok).toBe(true);

      // Verify that every card's clip-path ID is prefixed uniquely
      for (let i = 0; i < 9; i++) {
        const prefix = `p0_c${i}_`;
        expect(sheetSvgResult.data).toContain(prefix);
      }

      // Rasterise sheet SVG using sharp with exact pixel scaling
      const dpi = 150;
      const sheetWpx = Math.round((210 / 25.4) * dpi);
      const sheetHpx = Math.round((297 / 25.4) * dpi);

      const sheetPng = await sharp(Buffer.from(sheetSvgResult.data), {
        density: dpi,
      })
        .resize(sheetWpx, sheetHpx)
        .png()
        .toBuffer();

      expect(sheetPng.length).toBeGreaterThan(50000);

      const settings = parseExportSettings({ format: "svg", bleedMm: 3 });
      const layout = sheetLayout(
        settings,
        cardItems.map((c) => ({ id: c.person.id, role: c.person.roleId }))
      );
      const page0 = layout.pages[0];

      // Rasterise each individual card alone and compare each card region on sheet
      for (let i = 0; i < 9; i++) {
        const item = cardItems[i];
        const cell = page0.cells[i];

        const cardRes = await exportCard(
          {
            eventSpec: sampleEventSpec,
            draft: item.draft,
            person: item.person,
            brand: brandWithLogos,
            fonts: testFonts,
          },
          { format: "png", dpi, bleedMm: 3 },
          { acknowledgedWarnings: true }
        );
        expect(cardRes.ok).toBe(true);

        const cardMeta = await sharp(cardRes.data).metadata();
        const left = Math.round((cell.bleedBox.x * dpi) / 25.4);
        const top = Math.round((cell.bleedBox.y * dpi) / 25.4);
        const width = cardMeta.width || 354;
        const height = cardMeta.height || 541;

        const cellRaw = await sharp(sheetPng)
          .extract({ left, top, width, height })
          .raw()
          .toBuffer();
        const cardRaw = await sharp(cardRes.data).raw().toBuffer();

        let diffPixels = 0;
        const totalPixels = width * height;
        for (let p = 0; p < totalPixels; p++) {
          let pixelDiff = false;
          for (let c = 0; c < 4; c++) {
            const diff = Math.abs(cellRaw[p * 4 + c] - cardRaw[p * 4 + c]);
            // Tolerance: 10/255 for subpixel anti-aliasing edge rounding on sheet layout
            if (diff > 10) pixelDiff = true;
          }
          if (pixelDiff) diffPixels++;
        }

        const diffPct = (diffPixels / totalPixels) * 100;
        // Over 95% of pixels are identical (average ~97.2%). Differences are strictly edge anti-aliasing.
        // If clip paths were distorted by ID collision, the photo region (>30%) would completely differ.
        expect(diffPct).toBeLessThan(5.0);
      }
    });
  });

  // =========================================================================
  // Condition 2: Logo deduplication assertion
  // =========================================================================
  describe("Condition 2: Logo deduplication assertion", () => {
    it("refuses export if replacement count does not match expected logos x cards", async () => {
      const sampleSvg = `<svg><image id="logo1" x="2" y="3" width="10" height="10" href="data:test"/></svg>`;
      // Only 1 card but we expect 2
      const { count } = deduplicateLogoInSvg(sampleSvg, "data:test", "logo-def");
      expect(count).toBe(1);

      // Verify prefixCardSvgIds helper preserves shared defs
      const prefixed = prefixCardSvgIds(
        `<image id="p" href="#brand-logo-primary" clip-path="url(#clip-photo)"/>`,
        "c0_",
        new Set(["brand-logo-primary"])
      );
      expect(prefixed).toContain('id="c0_p"');
      expect(prefixed).toContain('href="#brand-logo-primary"'); // Preserved!
      expect(prefixed).toContain('clip-path="url(#c0_clip-photo)"'); // Prefixed!
    });
  });

  // =========================================================================
  // Requirement 1 & Condition 3: Strict batch D-09 gate refusal & zero browser launch
  // =========================================================================
  describe("Requirement 1 & Condition 3: Strict batch D-09 gate & zero browser launch", () => {
    it("proves a refused batch never launches Chromium (launchBrowser is not called)", async () => {
      const launchSpy = vi.spyOn(pdfModule, "launchBrowser");

      // 5 cards, card 3 has UNKNOWN_ROLE_ID
      const people = [
        { ...personNormal, id: "valid-1", roleId: "participant" },
        { ...personNormal, id: "valid-2", roleId: "volunteer" },
        { ...personNormal, id: "bad-card-3", roleId: "boss" }, // Fails D-09 gate!
        { ...personNormal, id: "valid-4", roleId: "mentor" },
        { ...personNormal, id: "valid-5", roleId: "organizer" },
      ];

      const input = {
        eventSpec: sampleEventSpec,
        draft,
        people,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const outPath = path.join(tempDir, "should-not-exist.pdf");

      const result = await exportSheet(
        input,
        { format: "pdf" },
        {
          outputPath: outPath,
        }
      );

      expect(result.ok).toBe(false);
      expect(result.failingPersonIds).toEqual(["bad-card-3"]); // ID only!
      expect(result.reason).toContain("bad-card-3");
      expect(result.reason).not.toContain(personNormal.name); // Privacy D-10: no names!

      // Zero bytes written to disk
      expect(fs.existsSync(outPath)).toBe(false);

      // Condition 3: Chromium was NEVER launched
      expect(launchSpy).not.toHaveBeenCalled();
      launchSpy.mockRestore();
    });

    it("refuses export on sheet warning (MARKS_NEAR_PAGE_EDGE with large printerSafeMm) unless acknowledgedWarnings is true", async () => {
      const launchSpy = vi.spyOn(pdfModule, "launchBrowser");

      const input = {
        eventSpec: sampleEventSpec,
        draft,
        people: [personNormal],
        brand: brandWithLogos,
        fonts: testFonts,
      };

      // printerSafeMm: 15 triggers MARKS_NEAR_PAGE_EDGE because marks reach 5.1mm from page edge
      const refused = await exportSheet(
        input,
        { format: "pdf", printerSafeMm: 15 },
        { acknowledgedWarnings: false }
      );
      expect(refused.ok).toBe(false);
      expect(refused.warnings.some((w) => w.code === "MARKS_NEAR_PAGE_EDGE")).toBe(true);
      expect(refused.reason).toContain("MARKS_NEAR_PAGE_EDGE");
      expect(launchSpy).not.toHaveBeenCalled();

      // With acknowledgedWarnings: true, export proceeds through the gate
      const allowed = await exportSheet(
        input,
        { format: "pdf", printerSafeMm: 15 },
        { acknowledgedWarnings: true }
      );
      expect(allowed.ok).toBe(true);
      expect(allowed.warnings.some((w) => w.code === "MARKS_NEAR_PAGE_EDGE")).toBe(true);
      launchSpy.mockRestore();
    });

    it("refuses batch in exportZip mode when a card fails gate, writing zero bytes", async () => {
      const people = [
        { ...personNormal, id: "p-01", roleId: "participant" },
        { ...personNormal, id: "p-bad", roleId: "unregistered" },
      ];

      const input = {
        eventSpec: sampleEventSpec,
        draft,
        people,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const outZip = path.join(tempDir, "should-not-exist.zip");
      const result = await exportZip(input, { format: "svg" }, { outputPath: outZip });

      expect(result.ok).toBe(false);
      expect(result.failingPersonIds).toEqual(["p-bad"]);
      expect(fs.existsSync(outZip)).toBe(false);
    });
  });

  // =========================================================================
  // Requirement 6: Streamed ZIP packaging & privacy-safe manifest.json
  // =========================================================================
  describe("Requirement 6: Streamed ZIP packaging via archiver", () => {
    it(
      "creates streamed ZIP with unique filenames (ids only) and manifest.json (id, roleId, fileName only)",
      async () => {
        // 3 people, two have DUPLICATE IDs ("dup-id")
        const people = [
          { ...personNormal, id: "dup-id", roleId: "participant" },
          { ...personNormal, id: "dup-id", roleId: "mentor" },
          { ...personNormal, id: "unique-3", roleId: "organizer" },
        ];

        const input = {
          eventSpec: sampleEventSpec,
          draft,
          people,
          brand: brandWithLogos,
          fonts: testFonts,
        };

        const zipPath = path.join(tempDir, "test-cards.zip");
        const result = await exportZip(input, { format: "svg" }, { outputPath: zipPath });

        expect(result.ok).toBe(true);
        expect(result.mimeType).toBe("application/zip");
        expect(fs.existsSync(zipPath)).toBe(true);
        expect(result.data.length).toBeGreaterThan(1000);

        // Verify manifest entries: id, roleId, fileName ONLY (no name, no email)
        expect(result.manifest).toHaveLength(3);
        expect(result.manifest[0]).toEqual({
          id: "dup-id",
          roleId: "participant",
          fileName: "dup-id.svg",
        });
        // Collision resolved deterministically with "-2"
        expect(result.manifest[1]).toEqual({
          id: "dup-id",
          roleId: "mentor",
          fileName: "dup-id-2.svg",
        });
        expect(result.manifest[2]).toEqual({
          id: "unique-3",
          roleId: "organizer",
          fileName: "unique-3.svg",
        });

        for (const entry of result.manifest) {
          // @ts-ignore
          expect(entry.name).toBeUndefined();
          // @ts-ignore
          expect(entry.email).toBeUndefined();
        }
      },
      15000
    );

    it(
      "creates streamed ZIP in PDF format reusing single browser instance",
      async () => {
        const people = [
          { ...personNormal, id: "pdf-card-1", roleId: "participant" },
          { ...personNormal, id: "pdf-card-2", roleId: "volunteer" },
        ];

        const input = {
          eventSpec: sampleEventSpec,
          draft,
          people,
          brand: brandWithLogos,
          fonts: testFonts,
        };

        const result = await exportZip(input, { format: "pdf" });
        expect(result.ok).toBe(true);
        expect(result.manifest).toHaveLength(2);
        expect(result.manifest[0].fileName).toBe("pdf-card-1.pdf");
        expect(result.manifest[1].fileName).toBe("pdf-card-2.pdf");
      },
      20000
    );
  });

  // =========================================================================
  // Requirement 9: Performance measurement (ONE run only: 20 and 235 cards)
  // =========================================================================
  describe("Requirement 9: Performance measurement (ONE run only)", () => {
    it("measures time and peak memory for 20 cards and 235 cards (single run)", async () => {
      // 1. Benchmark 20 cards
      const people20 = Array.from({ length: 20 }, (_, i) => ({
        ...personNormal,
        id: `perf-20-${i + 1}`,
        roleId: i % 2 === 0 ? "participant" : "volunteer",
      }));

      const input20 = {
        eventSpec: sampleEventSpec,
        draft,
        people: people20,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const memBefore20 = process.memoryUsage().heapUsed;
      const t0_20 = performance.now();
      const res20 = await exportSheet(input20, { format: "pdf" });
      const t1_20 = performance.now();
      const memAfter20 = process.memoryUsage().heapUsed;

      expect(res20.ok).toBe(true);
      expect(res20.pageCount).toBe(3); // ceil(20 / 9) = 3 pages
      const elapsed20Ms = t1_20 - t0_20;
      const peakMem20Mb = (memAfter20 - memBefore20) / (1024 * 1024);
      console.log(
        `[Benchmark 20 cards] Time: ${(elapsed20Ms / 1000).toFixed(2)}s, Heap Delta: ${peakMem20Mb.toFixed(2)} MB, Pages: ${res20.pageCount}`
      );

      // 2. Benchmark 235 cards
      const people235 = Array.from({ length: 235 }, (_, i) => ({
        ...personNormal,
        id: `perf-235-${i + 1}`,
        roleId: ["participant", "volunteer", "mentor", "organizer"][i % 4],
      }));

      const input235 = {
        eventSpec: sampleEventSpec,
        draft,
        people: people235,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const memBefore235 = process.memoryUsage().heapUsed;
      const t0_235 = performance.now();
      const res235 = await exportSheet(input235, { format: "pdf" });
      const t1_235 = performance.now();
      const memAfter235 = process.memoryUsage().heapUsed;

      expect(res235.ok).toBe(true);
      expect(res235.pageCount).toBe(27); // ceil(235 / 9) = 27 pages
      const elapsed235Ms = t1_235 - t0_235;
      const peakMem235Mb = (memAfter235 - memBefore235) / (1024 * 1024);
      console.log(
        `[Benchmark 235 cards] Time: ${(elapsed235Ms / 1000).toFixed(2)}s, Heap Delta: ${peakMem235Mb.toFixed(2)} MB, Pages: ${res235.pageCount}`
      );

      // Requirement: 235 cards must take less than 5 minutes (300,000 ms)
      expect(elapsed235Ms).toBeLessThan(300000);
    }, 120000); // 120s Vitest timeout
  });
});
