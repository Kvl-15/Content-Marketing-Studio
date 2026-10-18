// @ts-check
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import {
  personLongName,
  personNoPhoto,
  personNormal,
  sampleBrandKit,
  sampleEventSpec,
} from "./fixtures.js";
import { renderCard } from "./render.js";
import { loadContent, loadLogoAsset } from "../scripts/loadContent.js";

describe("Task 7C: Real Logo Images in Renderer & Validator", () => {
  const content = loadContent();
  const fontPath = resolve(process.cwd(), "assets/fonts/Roboto-VariableFont_wdth,wght.ttf");
  const fontBuf = readFileSync(fontPath);
  const font = opentype.parse(
    fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength)
  );

  const testBrandKit = content.brandKits["test-logos"];
  expect(testBrandKit).toBeDefined();

  // (a) Aspect ratio matching within 0.5% for 4:1 (wide), 1:1 (square), and 1:3 (tall)
  describe("(a) Logo aspect ratio preservation", () => {
    const testRatios = [
      { name: "wide 4:1", w: 800, h: 200 },
      { name: "square 1:1", w: 500, h: 500 },
      { name: "tall 1:3", w: 300, h: 900 },
    ];

    for (const ratio of testRatios) {
      it(`preserves ${ratio.name} aspect ratio within 0.5% in every look`, () => {
        const dummyBrand = {
          ...testBrandKit,
          logos: {
            primary: {
              ...testBrandKit.logos.primary,
              width: ratio.w,
              height: ratio.h,
              dataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            },
            secondary: {
              ...testBrandKit.logos.secondary,
              width: ratio.w,
              height: ratio.h,
              dataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            },
          },
        };

        const srcRatio = ratio.w / ratio.h;

        for (const [lookId, look] of Object.entries(content.looks)) {
          const skeleton = content.skeletons[look.skeleton];
          const res = renderCard({
            person: personNormal,
            event: sampleEventSpec,
            brand: dummyBrand,
            card: sampleEventSpec.card,
            skeleton,
            blocks: content.blocks,
            look,
            font,
          });

          const logoNodes = res.scene.filter(
            (n) => n.type === "image" && (n.id === "logo1" || n.id === "logo2")
          );

          expect(logoNodes.length, `Look "${lookId}" should have rendered logo nodes`).toBeGreaterThan(0);

          for (const node of logoNodes) {
            const drawnRatio = node.box.w / node.box.h;
            const diff = Math.abs(drawnRatio - srcRatio) / srcRatio;
            expect(
              diff,
              `Look "${lookId}" logo "${node.id}" drawn ratio ${drawnRatio} vs source ${srcRatio}`
            ).toBeLessThan(0.005);
          }

          // Zero LOGO_DISTORTED issues
          const distorted = res.issues.filter((i) => i.code === "LOGO_DISTORTED");
          expect(distorted).toHaveLength(0);
        }
      });
    }
  });

  // (b) Missing logo file gives clear loader error
  describe("(b) Missing logo error handling", () => {
    it("throws a clear error when a referenced logo file does not exist", () => {
      expect(() => {
        loadLogoAsset("assets/test-logos/non-existent-logo-file.png", "test-brand");
      }).toThrow(/Logo file not found.*non-existent-logo-file\.png/);
    });
  });

  // (c) Oversized logo is shrunk, never cropped or stretched
  describe("(c) Oversized logo contain fit", () => {
    it("shrinks a huge 4000x2000 logo without cropping or stretching", () => {
      const hugeBrand = {
        ...testBrandKit,
        logos: {
          primary: {
            ...testBrandKit.logos.primary,
            width: 4000,
            height: 2000,
            dataUri: "data:image/png;base64,iVBORw0KGgo=",
          },
          secondary: {
            ...testBrandKit.logos.secondary,
            width: 4000,
            height: 2000,
            dataUri: "data:image/png;base64,iVBORw0KGgo=",
          },
        },
      };

      const look = content.looks["look.bold"];
      const res = renderCard({
        person: personNormal,
        event: sampleEventSpec,
        brand: hugeBrand,
        card: sampleEventSpec.card,
        skeleton: content.skeletons[look.skeleton],
        blocks: content.blocks,
        look,
        font,
      });

      const logo1 = res.scene.find((n) => n.id === "logo1");
      expect(logo1).toBeDefined();
      expect(logo1.type).toBe("image");
      // Must fit inside slot and header band
      expect(logo1.box.w).toBeLessThanOrEqual(20.52 + 0.01);
      expect(logo1.box.h).toBeLessThanOrEqual(18.20 + 0.01);
      // Exact aspect ratio 2.0 preserved
      expect(Math.abs(logo1.box.w / logo1.box.h - 2.0)).toBeLessThan(0.005);
      // SVG contains the image element
      expect(res.svg).toContain(`<image id="logo1"`);
    });

    it("flags LOGO_CLEARSPACE when an element encroaches within clearSpaceMm", () => {
      const tightBrand = {
        ...testBrandKit,
        logos: {
          primary: { ...testBrandKit.logos.primary, clearSpaceMm: 2 },
          secondary: { ...testBrandKit.logos.secondary, clearSpaceMm: 2 },
        },
      };
      const res = renderCard({
        person: personNormal,
        event: sampleEventSpec,
        brand: tightBrand,
        card: sampleEventSpec.card,
        skeleton: content.skeletons["portrait"],
        blocks: content.blocks,
        look: content.looks["look.bold"],
        font,
      });
      const clearspaceIssues = res.issues.filter((i) => i.code === "LOGO_CLEARSPACE");
      expect(clearspaceIssues.length).toBeGreaterThan(0);
      expect(clearspaceIssues[0].message).toContain("encroaches on clear space of logo");
    });

    it("flags LOGO_TOO_SMALL when a logo is scaled below minWidthMm", () => {
      const strictBrand = {
        ...testBrandKit,
        logos: {
          primary: { ...testBrandKit.logos.primary, minWidthMm: 25 },
          secondary: { ...testBrandKit.logos.secondary, minWidthMm: 25 },
        },
      };
      const res = renderCard({
        person: personNormal,
        event: sampleEventSpec,
        brand: strictBrand,
        card: sampleEventSpec.card,
        skeleton: content.skeletons["portrait"],
        blocks: content.blocks,
        look: content.looks["look.bold"],
        font,
      });
      const tooSmallIssues = res.issues.filter((i) => i.code === "LOGO_TOO_SMALL");
      expect(tooSmallIssues.length).toBeGreaterThan(0);
      expect(tooSmallIssues[0].message).toContain("below minimum required");
    });
  });

  // (d) Zero validator ERRORS for every look x palette x person with the test logos
  describe("(d) Stress test with real test logos", () => {
    it("renders zero validator ERRORS across 6 looks x 6 palettes x 3 persons", () => {
      const palettes = [
        ["#0A192F", "#FF6B35"],
        ["#1E3A2F", "#F5EBE0"],
        ["#4A154B", "#E01E5A"],
        ["#DC2626", "#18181B"],
        ["#0D9488", "#FBBF24"],
        ["#0085FF", "#111827"],
      ];
      const persons = [personNormal, personLongName, personNoPhoto];
      const lookList = Object.values(content.looks);

      let totalCards = 0;
      let totalWarnings = 0;
      /** @type {string[]} */
      const warningMessages = [];

      for (const look of lookList) {
        const skeleton = content.skeletons[look.skeleton];
        for (const palette of palettes) {
          for (const person of persons) {
            totalCards++;
            const res = renderCard({
              person,
              event: sampleEventSpec,
              brand: testBrandKit,
              card: sampleEventSpec.card,
              skeleton,
              blocks: content.blocks,
              look,
              palette,
              font,
            });

            const errors = res.issues.filter((i) => i.severity === "error");
            if (errors.length > 0) {
              console.error(`Validation error in ${look.id}:`, errors);
            }
            expect(errors).toHaveLength(0);

            const warnings = res.issues.filter((i) => i.severity === "warning");
            totalWarnings += warnings.length;
            for (const w of warnings) {
              const msg = `[${look.id}][${person.id}] ${w.code}: ${w.message}`;
              if (!warningMessages.includes(msg)) {
                warningMessages.push(msg);
              }
            }
          }
        }
      }

      console.log(`Rendered ${totalCards} cards with test logos. 0 errors, ${totalWarnings} warnings.`);
      if (warningMessages.length > 0) {
        console.log("Distinct warnings encountered:", warningMessages);
      }
      expect(totalCards).toBe(108);
    });
  });

  // (e) look.bold golden files unchanged with default placeholder brand kit
  describe("(e) Golden SVG byte-identity with placeholder brand kit", () => {
    it("renders personNormal byte-identical to golden SVG", () => {
      const goldenPath = resolve(process.cwd(), "core/golden/personNormal.svg");
      const goldenSvg = readFileSync(goldenPath, "utf8");

      const result = renderCard({
        person: personNormal,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        font,
        skeleton: content.skeletons.portrait,
        blocks: content.blocks,
        theme: content.themes["brand-blue"],
        look: content.looks["look.bold"],
      });

      expect(result.svg).toBe(goldenSvg);
    });

    it("renders personLongName byte-identical to golden SVG", () => {
      const goldenPath = resolve(process.cwd(), "core/golden/personLongName.svg");
      const goldenSvg = readFileSync(goldenPath, "utf8");

      const result = renderCard({
        person: personLongName,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        font,
        skeleton: content.skeletons.portrait,
        blocks: content.blocks,
        theme: content.themes["brand-blue"],
        look: content.looks["look.bold"],
      });

      expect(result.svg).toBe(goldenSvg);
    });
  });
});
