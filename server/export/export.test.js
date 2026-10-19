// @ts-check
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import opentype from "opentype.js";
import {
  exportCard,
  checkExportGate,
  fileNameFor,
  uniqueFileNames,
} from "./index.js";
import {
  sampleEventSpec,
  sampleBrandKit,
  personNormal,
  personNoPhoto,
} from "../../core/fixtures.js";
import { composeDrafts } from "../../core/composer.js";
import { ExportSettingsError } from "../../core/exportSettings.js";
import { loadContent } from "../../scripts/loadContent.js";

function loadFont(relPath) {
  const fullPath = path.resolve(process.cwd(), relPath);
  const buf = fs.readFileSync(fullPath);
  return opentype.parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
}

describe("E2a: Single-Card Export & D-09 Gate", () => {
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
      path.join(os.tmpdir(), "acm-export-test-"),
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
      // ignore
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. checkExportGate
  // ═══════════════════════════════════════════════════════════════════════
  describe("checkExportGate", () => {
    it("fails closed when issues is missing, null, undefined, or not an array", () => {
      // @ts-expect-error testing invalid inputs
      expect(checkExportGate(null).ok).toBe(false);
      // @ts-expect-error testing invalid inputs
      expect(checkExportGate(undefined).ok).toBe(false);
      // @ts-expect-error testing invalid inputs
      expect(checkExportGate("not an array").ok).toBe(false);
      // @ts-expect-error testing invalid inputs
      expect(checkExportGate({}).ok).toBe(false);
    });

    it("refuses export when errors are present (e.g. UNKNOWN_ROLE_ID)", () => {
      const issues = [
        {
          severity: "error",
          code: "UNKNOWN_ROLE_ID",
          message: "Role 'boss' not in event.roles",
        },
      ];
      const result = checkExportGate(issues);
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.reason).toContain("UNKNOWN_ROLE_ID");
    });

    it("refuses export on warnings (e.g. OUTSIDE_SAFE_MARGIN, ELEMENT_DROPPED) when not acknowledged", () => {
      const issues = [
        {
          severity: "warning",
          code: "OUTSIDE_SAFE_MARGIN",
          message: "Node touches margin",
        },
        {
          severity: "warning",
          code: "ELEMENT_DROPPED",
          message: "QR code dropped",
        },
      ];
      const result = checkExportGate(issues, { acknowledgedWarnings: false });
      expect(result.ok).toBe(false);
      expect(result.warnings).toHaveLength(2);
      expect(result.reason).toContain("OUTSIDE_SAFE_MARGIN");
    });

    it("allows export on warnings when acknowledgedWarnings is true", () => {
      const issues = [
        {
          severity: "warning",
          code: "OUTSIDE_SAFE_MARGIN",
          message: "Node touches margin",
        },
        {
          severity: "warning",
          code: "ELEMENT_DROPPED",
          message: "QR code dropped",
        },
      ];
      const result = checkExportGate(issues, { acknowledgedWarnings: true });
      expect(result.ok).toBe(true);
      expect(result.warnings).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(result.reason).toBeNull();
    });

    it("allows export when there are no issues or only info", () => {
      expect(checkExportGate([]).ok).toBe(true);
      expect(checkExportGate([{ severity: "info", message: "Note" }]).ok).toBe(
        true,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. fileNameFor & uniqueFileNames
  // ═══════════════════════════════════════════════════════════════════════
  describe("fileNameFor & uniqueFileNames", () => {
    it("uses person.id and never falls back to person.name or email", () => {
      const person = {
        id: "HX26-P-001",
        name: "Alice Smith",
        email: "alice@example.com",
      };
      expect(fileNameFor(person, "svg")).toBe("HX26-P-001.svg");
      expect(fileNameFor(person, "png")).toBe("HX26-P-001.png");
    });

    it("falls back to card.ext if id is missing or empty after sanitising", () => {
      expect(fileNameFor(null, "svg")).toBe("card.svg");
      expect(fileNameFor({}, "png")).toBe("card.png");
      expect(fileNameFor({ id: "   " }, "svg")).toBe("card.svg");
      expect(fileNameFor({ id: "" }, "svg", 2)).toBe("card-2.svg");
    });

    it("prevents path traversal attacks (../..)", () => {
      const name = fileNameFor({ id: "../../etc/passwd" }, "svg");
      expect(name).not.toContain("..");
      expect(name).not.toContain("/");
      expect(name).not.toContain("\\");
      expect(name).toBe("etc-passwd.svg");
    });

    it("replaces slashes with hyphens (a/b -> a-b)", () => {
      expect(fileNameFor({ id: "a/b" }, "svg")).toBe("a-b.svg");
      expect(fileNameFor({ id: "a\\b" }, "png")).toBe("a-b.png");
    });

    it("guards Windows reserved names with extension (CON.svg -> card-CON.svg)", () => {
      expect(fileNameFor({ id: "CON" }, "svg")).toBe("card-CON.svg");
      expect(fileNameFor({ id: "con" }, "png")).toBe("card-con.png");
      expect(fileNameFor({ id: "PRN" }, "svg")).toBe("card-PRN.svg");
      expect(fileNameFor({ id: "NUL" }, "svg")).toBe("card-NUL.svg");
      expect(fileNameFor({ id: "COM1" }, "png")).toBe("card-COM1.png");
    });

    it("strips trailing dots and spaces", () => {
      expect(fileNameFor({ id: "my-card...   " }, "svg")).toBe("my-card.svg");
    });

    it("caps 200-character id to safe length (max 64 chars base)", () => {
      const longId = "a".repeat(200);
      const name = fileNameFor({ id: longId }, "svg");
      expect(name.length).toBeLessThanOrEqual("a".repeat(64).length + 4);
      expect(name).toBe(`${"a".repeat(64)}.svg`);
    });

    it("handles unicode, emoji, and control characters safely", () => {
      const nameWithEmoji = fileNameFor({ id: "person-🚀-01" }, "svg");
      expect(nameWithEmoji).toContain("person-🚀-01.svg");

      const nameWithControl = fileNameFor({ id: "bad\x00\x1f-id" }, "svg");
      expect(nameWithControl).toBe("bad-id.svg");
    });

    it("uniqueFileNames resolves duplicate IDs deterministically with case-insensitivity", () => {
      const people = [
        { id: "user" },
        { id: "user" },
        { id: "USER" },
        { id: "other" },
      ];
      const names = uniqueFileNames(people, "svg");
      expect(names).toEqual([
        "user.svg",
        "user-2.svg",
        "USER-3.svg",
        "other.svg",
      ]);
      const lower = names.map((n) => n.toLowerCase());
      expect(new Set(lower).size).toBe(names.length);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. exportCard End-to-End & Asset Preflight Checks
  // ═══════════════════════════════════════════════════════════════════════
  describe("exportCard End-to-End & Asset Checks", () => {
    it("refuses export when input.fonts is missing", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: personNormal,
        brand: brandWithLogos,
        // fonts omitted
      };
      const outputPath = path.join(tempDir, "no-fonts.svg");
      const result = await exportCard(input, { format: "svg" }, { outputPath });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("missing loaded fonts in input.fonts");
      expect(result.errors?.some((e) => e.code === "MISSING_FONTS")).toBe(true);
      expect(fs.existsSync(outputPath)).toBe(false);
    });

    it("refuses export when brand kit logo has no loaded image data (dataUri/dimensions)", async () => {
      const unpopulatedBrand = {
        ...brandWithLogos,
        logos: {
          primary: { file: "primary.svg", minWidthMm: 12, clearSpaceMm: 2 }, // missing dataUri/w/h
        },
      };
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: personNormal,
        brand: unpopulatedBrand,
        fonts: testFonts,
      };
      const outputPath = path.join(tempDir, "no-logo-assets.svg");
      const result = await exportCard(input, { format: "svg" }, { outputPath });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("missing loaded image data");
      expect(
        result.errors?.some((e) => e.code === "MISSING_LOGO_ASSETS"),
      ).toBe(true);
      expect(fs.existsSync(outputPath)).toBe(false);
    });

    it("blocks export on UNKNOWN_ROLE_ID end-to-end", async () => {
      const badPerson = {
        id: "P-BAD",
        name: "Unknown Role Person",
        roleId: "boss", // Unknown role
        photo: "https://example.org/p.jpg",
      };
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: badPerson,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const result = await exportCard(input, { format: "svg" });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("UNKNOWN_ROLE_ID");
      expect(result.errors?.some((e) => e.code === "UNKNOWN_ROLE_ID")).toBe(
        true,
      );
    });

    it("blocks export on warning (e.g. NO_PHOTO) unless acknowledged", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: personNoPhoto,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const unack = await exportCard(
        input,
        { format: "svg" },
        { acknowledgedWarnings: false },
      );
      expect(unack.ok).toBe(false);
      expect(unack.reason).toContain("NO_PHOTO");

      const ack = await exportCard(
        input,
        { format: "svg" },
        { acknowledgedWarnings: true },
      );
      expect(ack.ok).toBe(true);
      expect(ack.warnings?.some((w) => w.code === "NO_PHOTO")).toBe(true);
    });

    it("creates no file on disk when export is refused", async () => {
      const badPerson = {
        id: "P-BAD",
        name: "Unknown Role Person",
        roleId: "boss",
      };
      const outputPath = path.join(tempDir, "should-not-exist.png");
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: badPerson,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const result = await exportCard(
        input,
        { format: "png" },
        { outputPath },
      );
      expect(result.ok).toBe(false);
      expect(fs.existsSync(outputPath)).toBe(false);
    });

    it("returns clear error when format is 'pdf' (deferred to E2b)", async () => {
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
      expect(result.data.length).toBeGreaterThan(1000);

      // Verify PDF byte structure directly (MediaBox 60 x 91.6 mm, no embedded fonts)
      const pdfText = result.data.toString("latin1");
      expect(pdfText.startsWith("%PDF-")).toBe(true);
      expect(/\/Type\s*\/Page\b/.test(pdfText)).toBe(true);
      expect(/\/Type\s*\/Font\b/.test(pdfText)).toBe(false);

      const mediaBoxMatch = pdfText.match(
        /\/MediaBox\s*\[\s*([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s*\]/
      );
      expect(mediaBoxMatch).not.toBeNull();
      const [, x1, y1, x2, y2] = mediaBoxMatch;
      const wMm = ((parseFloat(x2) - parseFloat(x1)) * 25.4) / 72;
      const hMm = ((parseFloat(y2) - parseFloat(y1)) * 25.4) / 72;
      expect(wMm).toBeCloseTo(60, 0.5);
      expect(hMm).toBeCloseTo(91.6, 0.5);
    });

    it("refuses landscape orientation with a clear message (portrait-only layouts)", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: personNormal,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const result = await exportCard(input, {
        format: "svg",
        orientation: "landscape",
        bleedMm: 3,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain(
        "Orientation 'landscape' is not supported in E2a",
      );
    });

    it("surfaces Zod validation errors unchanged for invalid export settings", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: personNormal,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      await expect(
        exportCard(input, { format: "svg", dpi: 50 }),
      ).rejects.toThrow(ExportSettingsError);
      await expect(
        exportCard(input, { format: "svg", bleedMm: 25 }),
      ).rejects.toThrow(ExportSettingsError);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. SVG Structure, Embedded Logos, & Determinism
  // ═══════════════════════════════════════════════════════════════════════
  describe("SVG Structure & Non-Empty Card Verification", () => {
    it("exports clean SVG with exact mm dimensions and viewBox at bleed 3", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: personNormal,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const result = await exportCard(
        input,
        { format: "svg", bleedMm: 3 },
        { acknowledgedWarnings: true },
      );
      expect(result.ok).toBe(true);
      expect(result.mimeType).toBe("image/svg+xml");
      expect(typeof result.data).toBe("string");

      const svg = /** @type {string} */ (result.data);
      expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(
        true,
      );
      expect(svg).toContain('width="60mm"');
      expect(svg).toContain('height="91.6mm"');
      expect(svg).toContain('viewBox="-3 -3 60 91.6"');

      // Rule D-28: all text rendered as outlines, no <text> or font-family
      expect(svg).not.toContain("<text");
      expect(svg).not.toContain("font-family");
    });

    it("is 100% byte-identical across two separate runs", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: personNormal,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const run1 = await exportCard(
        input,
        { format: "svg", bleedMm: 3 },
        { acknowledgedWarnings: true },
      );
      const run2 = await exportCard(
        input,
        { format: "svg", bleedMm: 3 },
        { acknowledgedWarnings: true },
      );

      expect(run1.data).toBe(run2.data);
    });

    it("differs between 0mm bleed and 3mm bleed by exactly the bleed amount", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: personNormal,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const b0 = await exportCard(
        input,
        { format: "svg", bleedMm: 0 },
        { acknowledgedWarnings: true },
      );
      const b3 = await exportCard(
        input,
        { format: "svg", bleedMm: 3 },
        { acknowledgedWarnings: true },
      );

      expect(b0.ok).toBe(true);
      expect(b3.ok).toBe(true);

      const svg0 = /** @type {string} */ (b0.data);
      const svg3 = /** @type {string} */ (b3.data);

      expect(svg0).toContain('width="54mm"');
      expect(svg0).toContain('height="85.6mm"');
      expect(svg0).toContain('viewBox="0 0 54 85.6"');

      expect(svg3).toContain('width="60mm"');
      expect(svg3).toContain('height="91.6mm"');
      expect(svg3).toContain('viewBox="-3 -3 60 91.6"');
    });

    it("contains at least one <image> per logo with valid data URI when brand has logo assets", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: personNormal,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const result = await exportCard(
        input,
        { format: "svg", bleedMm: 3 },
        { acknowledgedWarnings: true },
      );
      expect(result.ok).toBe(true);

      const svg = /** @type {string} */ (result.data);
      const imageTags = svg.match(/<image[^>]*>/g) || [];
      expect(imageTags.length).toBeGreaterThanOrEqual(2);

      for (const imgTag of imageTags) {
        expect(imgTag).toContain('href="data:image/');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. PNG Rasterisation, Non-Empty Content, & Multi-Mode Bleed Verification
  // ═══════════════════════════════════════════════════════════════════════
  describe("PNG Rasterisation & Sharp Verification", () => {
    it("verifies exact pixel dimensions and density at 72, 300, 600, and 1200 DPI for bleed 0 and 3", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: personNormal,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const testCases = [
        // DPI, Bleed, Expected Width, Expected Height
        { dpi: 72, bleed: 0, w: 153, h: 243 },
        { dpi: 72, bleed: 3, w: 170, h: 260 },
        { dpi: 300, bleed: 0, w: 638, h: 1011 },
        { dpi: 300, bleed: 3, w: 709, h: 1082 },
        { dpi: 600, bleed: 0, w: 1276, h: 2022 },
        { dpi: 600, bleed: 3, w: 1417, h: 2164 },
        { dpi: 1200, bleed: 0, w: 2551, h: 4044 },
        { dpi: 1200, bleed: 3, w: 2835, h: 4328 },
      ];

      for (const tc of testCases) {
        const result = await exportCard(
          input,
          {
            format: "png",
            dpi: tc.dpi,
            bleedMm: tc.bleed,
          },
          { acknowledgedWarnings: true },
        );

        expect(result.ok).toBe(true);
        expect(Buffer.isBuffer(result.data)).toBe(true);

        const metadata = await sharp(
          /** @type {Buffer} */ (result.data),
        ).metadata();
        expect(metadata.width).toBe(tc.w);
        expect(metadata.height).toBe(tc.h);
        expect(metadata.density).toBe(tc.dpi);
      }
    });

    it("verifies real card PNG differs from same card without logos", async () => {
      const inputWithLogos = {
        eventSpec: sampleEventSpec,
        draft,
        person: personNormal,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      // Mock brand with placeholder logos (no dataUri)
      const noLogosBrand = {
        ...brandWithLogos,
        logos: {
          primary: {
            file: "assets/test-logos/logo-1.jpg",
            minWidthMm: 6,
            clearSpaceMm: 0,
            dataUri: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
            width: 10,
            height: 10,
          },
          secondary: {
            file: "assets/test-logos/logo-2.jpg",
            minWidthMm: 6,
            clearSpaceMm: 0,
            dataUri: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
            width: 10,
            height: 10,
          },
        },
      };
      const inputDifferentLogos = {
        ...inputWithLogos,
        brand: noLogosBrand,
      };

      const realResult = await exportCard(
        inputWithLogos,
        { format: "png", dpi: 300, bleedMm: 3 },
        { acknowledgedWarnings: true },
      );
      const diffResult = await exportCard(
        inputDifferentLogos,
        { format: "png", dpi: 300, bleedMm: 3 },
        { acknowledgedWarnings: true },
      );

      expect(realResult.ok).toBe(true);
      expect(diffResult.ok).toBe(true);

      const bufReal = /** @type {Buffer} */ (realResult.data);
      const bufDiff = /** @type {Buffer} */ (diffResult.data);
      expect(bufReal.equals(bufDiff)).toBe(false);
    });

    it("proves PNG is not just background plus one shape (> 5 distinct colors)", async () => {
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: personNormal,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const result = await exportCard(
        input,
        { format: "png", dpi: 300, bleedMm: 3 },
        { acknowledgedWarnings: true },
      );
      expect(result.ok).toBe(true);

      const { data: rawPixels } = await sharp(
        /** @type {Buffer} */ (result.data),
      )
        .raw()
        .toBuffer({ resolveWithObject: true });

      const distinctColors = new Set();
      for (let i = 0; i < rawPixels.length; i += 3) {
        distinctColors.add(
          `${rawPixels[i]},${rawPixels[i + 1]},${rawPixels[i + 2]}`,
        );
        if (distinctColors.size > 20) break;
      }
      expect(distinctColors.size).toBeGreaterThan(5);
    });

    it("verifies bleed extension at corner in ALL THREE modes (light, dark, colour-field)", async () => {
      for (const mode of ["light", "dark", "colour-field"]) {
        const modeDraft =
          drafts.find((d) => d.look.attributes.mode === mode) || draft;
        const input = {
          eventSpec: sampleEventSpec,
          draft: modeDraft,
          person: personNormal,
          brand: brandWithLogos,
          fonts: testFonts,
        };

        const result = await exportCard(
          input,
          { format: "png", dpi: 300, bleedMm: 3 },
          { acknowledgedWarnings: true },
        );
        expect(result.ok).toBe(true);

        const { data: rawPixels, info } = await sharp(
          /** @type {Buffer} */ (result.data),
        )
          .raw()
          .toBuffer({ resolveWithObject: true });

        const cornerR = rawPixels[0];
        const cornerG = rawPixels[1];
        const cornerB = rawPixels[2];

        if (mode === "dark") {
          // Dark mode background is #0B192E -> (11, 25, 46) extending into bleed corner
          expect(Math.abs(cornerR - 11)).toBeLessThanOrEqual(1);
          expect(Math.abs(cornerG - 25)).toBeLessThanOrEqual(1);
          expect(Math.abs(cornerB - 46)).toBeLessThanOrEqual(1);
        } else if (mode === "colour-field") {
          // Colour-field mode background is #0A192F -> (10, 25, 47) extending into bleed corner
          expect(Math.abs(cornerR - 10)).toBeLessThanOrEqual(1);
          expect(Math.abs(cornerG - 25)).toBeLessThanOrEqual(1);
          expect(Math.abs(cornerB - 47)).toBeLessThanOrEqual(1);
        } else if (mode === "light") {
          // Light mode (colour-block-split): role bar decor #2563EB -> (37, 99, 235) extends to (-3, -3)
          // Sample a pixel ~3 px inside the corner (x=3, y=3) to assert it equals the fill within 1 per channel
          const idx = (3 * info.width + 3) * info.channels;
          const r = rawPixels[idx];
          const g = rawPixels[idx + 1];
          const b = rawPixels[idx + 2];
          expect(Math.abs(r - 37)).toBeLessThanOrEqual(1);
          expect(Math.abs(g - 99)).toBeLessThanOrEqual(1);
          expect(Math.abs(b - 235)).toBeLessThanOrEqual(1);
        }
      }
    });

    it("writes valid PNG file to disk when outputPath is provided", async () => {
      const outputPath = path.join(tempDir, "export-test.png");
      const input = {
        eventSpec: sampleEventSpec,
        draft,
        person: personNormal,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const result = await exportCard(
        input,
        { format: "png", dpi: 300, bleedMm: 3 },
        { outputPath, acknowledgedWarnings: true },
      );
      expect(result.ok).toBe(true);
      expect(fs.existsSync(outputPath)).toBe(true);

      const fileStats = await fs.promises.stat(outputPath);
      expect(fileStats.size).toBeGreaterThan(0);

      const diskMeta = await sharp(outputPath).metadata();
      expect(diskMeta.width).toBe(709);
      expect(diskMeta.height).toBe(1082);
      expect(diskMeta.density).toBe(300);
    });
  });
});
