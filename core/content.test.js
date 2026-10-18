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
import {
  Block,
  BrandKit,
  Look,
  Skeleton,
  Theme,
} from "./schemas.js";
import { isPaletteCompatible } from "./themeDerivation.js";
import { loadContent } from "../scripts/loadContent.js";

describe("Task 7B: Content, Golden, Distinctness, and Stress Tests", () => {
  const content = loadContent();
  const fontPath = resolve(process.cwd(), "assets/fonts/Roboto-VariableFont_wdth,wght.ttf");
  const fontBuf = readFileSync(fontPath);
  const font = opentype.parse(
    fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength)
  );

  // 1. (a) Byte-identical SVG output compared to golden files
  describe("Golden SVG regression tests", () => {
    it("renders personNormal byte-identical to core/golden/personNormal.svg", () => {
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

    it("renders personLongName byte-identical to core/golden/personLongName.svg", () => {
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

  // 2. (b) Every JSON file in content/ passes its schema
  describe("Content schema validation", () => {
    it("validates all skeletons against Skeleton schema", () => {
      expect(Object.keys(content.skeletons).length).toBeGreaterThanOrEqual(3);
      for (const [id, skeleton] of Object.entries(content.skeletons)) {
        expect(() => Skeleton.parse(skeleton)).not.toThrow();
        expect(skeleton.id).toBe(id);
      }
    });

    it("validates all blocks against Block schema", () => {
      expect(Object.keys(content.blocks).length).toBeGreaterThanOrEqual(6);
      for (const [id, block] of Object.entries(content.blocks)) {
        expect(() => Block.parse(block)).not.toThrow();
        expect(block.id).toBe(id);
      }
    });

    it("validates all themes against Theme schema", () => {
      expect(Object.keys(content.themes).length).toBeGreaterThanOrEqual(3);
      for (const [id, theme] of Object.entries(content.themes)) {
        expect(() => Theme.parse(theme)).not.toThrow();
        expect(theme.id).toBe(id);
      }
    });

    it("validates all looks against Look schema", () => {
      expect(Object.keys(content.looks).length).toBe(6);
      for (const [id, look] of Object.entries(content.looks)) {
        expect(() => Look.parse(look)).not.toThrow();
        expect(look.id).toBe(id);
      }
    });

    it("validates all brand kits against BrandKit schema", () => {
      expect(Object.keys(content.brandKits).length).toBeGreaterThan(0);
      for (const [id, brandKit] of Object.entries(content.brandKits)) {
        expect(() => BrandKit.parse(brandKit)).not.toThrow();
        expect(brandKit.id).toBe(id);
      }
    });
  });

  // 3. (c) Cross-reference integrity
  describe("Cross-reference integrity", () => {
    it("every look refers to a skeleton, theme, and blocks that exist, with matching slots", () => {
      for (const [lookId, look] of Object.entries(content.looks)) {
        const skeleton = content.skeletons[look.skeleton];
        expect(skeleton, `Look "${lookId}" skeleton "${look.skeleton}" must exist`).toBeDefined();

        const theme = content.themes[look.theme];
        expect(theme, `Look "${lookId}" theme "${look.theme}" must exist`).toBeDefined();

        for (const [slotName, blockId] of Object.entries(look.blocks)) {
          const block = content.blocks[blockId];
          expect(block, `Look "${lookId}" block "${blockId}" must exist`).toBeDefined();
          expect(
            skeleton.slots,
            `Skeleton "${look.skeleton}" must have slot "${block.slot}"`
          ).toHaveProperty(block.slot);
          expect(block.slot).toBe(slotName);
        }
      }
    });
  });

  // 4. Declarative compatibility rules (spec 9.5)
  describe("Declarative compatibility rules", () => {
    it("none of the shipped looks violate compatibility rules", () => {
      const compat = content.compatibility;
      expect(compat).toBeDefined();

      for (const [lookId, look] of Object.entries(content.looks)) {
        for (const rule of compat.disallowedCombinations || []) {
          if (look.skeleton === rule.skeleton) {
            for (const [slot, disallowedBlock] of Object.entries(rule.blocks || {})) {
              expect(
                look.blocks[slot],
                `Look ${lookId} violates compatibility rule: ${rule.reason}`
              ).not.toBe(disallowedBlock);
            }
          }
        }
      }
    });
  });

  // 5. Distinctness distance rule (spec 9.2, 9.6, D-25)
  describe("Distinctness distance rule", () => {
    const WEIGHTS = { skeleton: 3, header: 2, marker: 2, theme: 2, photo: 1 };

    /**
     * @param {any} a
     * @param {any} b
     * @returns {number}
     */
    function distance(a, b) {
      return Object.entries(WEIGHTS).reduce(
        (sum, [k, w]) => sum + (a.attributes[k] !== b.attributes[k] ? w : 0),
        0
      );
    }

    it("verifies two non-overlapping groups of 3 looks where all pairs have distance >= 5", () => {
      const group1 = [
        content.looks["look.bold"],
        content.looks["look.minimal"],
        content.looks["look.tech"],
      ];

      const group2 = [
        content.looks["look.formal"],
        content.looks["look.playful"],
        content.looks["look.editorial"],
      ];

      // Disjoint groups
      const g1Ids = new Set(group1.map((l) => l.id));
      const g2Ids = new Set(group2.map((l) => l.id));
      for (const id of g1Ids) {
        expect(g2Ids.has(id)).toBe(false);
      }

      // Group 1 pairwise distances
      expect(distance(group1[0], group1[1])).toBeGreaterThanOrEqual(5); // Bold - Minimal = 7
      expect(distance(group1[0], group1[2])).toBeGreaterThanOrEqual(5); // Bold - Tech = 9
      expect(distance(group1[1], group1[2])).toBeGreaterThanOrEqual(5); // Minimal - Tech = 10

      // Group 2 pairwise distances
      expect(distance(group2[0], group2[1])).toBeGreaterThanOrEqual(5); // Formal - Playful = 10
      expect(distance(group2[0], group2[2])).toBeGreaterThanOrEqual(5); // Formal - Editorial = 10
      expect(distance(group2[1], group2[2])).toBeGreaterThanOrEqual(5); // Playful - Editorial = 10
    });
  });

  // 6. Determinism: same input produces identical output
  describe("Determinism", () => {
    it("produces identical SVG and scene for identical inputs", () => {
      const input = {
        person: personNormal,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        font,
        skeleton: content.skeletons.sidebar,
        blocks: content.blocks,
        look: content.looks["look.tech"],
        palette: ["#0A192F", "#FF6B35"],
      };

      const run1 = renderCard(input);
      const run2 = renderCard(input);
      expect(run1.svg).toBe(run2.svg);
      expect(run1.scene).toEqual(run2.scene);
      expect(run1.issues).toEqual(run2.issues);
    });
  });

  // 7. Stress test: 6 looks x 200 random palettes x 3 persons = 3,600 card renders
  describe("Stress test: 6 looks x 200 palettes x 3 persons", () => {
    it("renders with zero validator errors and reports autofix frequency", () => {
      // Deterministic PRNG for reproducibility
      let seed = 42;
      function randomHex() {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        const hex = (seed >>> 8).toString(16).padStart(6, "0").slice(0, 6);
        return `#${hex.toUpperCase()}`;
      }

      const randomPalettes = [];
      for (let i = 0; i < 200; i++) {
        randomPalettes.push([randomHex(), randomHex()]);
      }

      const persons = [personNormal, personLongName, personNoPhoto];
      const lookList = Object.values(content.looks);

      let totalRenders = 0;
      let autofixCount = 0;
      let incompatibleCount = 0;

      for (const look of lookList) {
        const skeleton = content.skeletons[look.skeleton];

        for (const palette of randomPalettes) {
          const compatCheck = isPaletteCompatible(look, palette);
          if (!compatCheck.compatible) {
            incompatibleCount++;
            continue;
          }

          for (const person of persons) {
            totalRenders++;
            const result = renderCard({
              person,
              event: sampleEventSpec,
              brand: sampleBrandKit,
              card: sampleEventSpec.card,
              skeleton,
              blocks: content.blocks,
              look,
              palette,
              font,
            });

            // Zero validator ERRORS allowed
            const errors = result.issues.filter((i) => i.severity === "error");
            if (errors.length > 0) {
              console.error(
                `Stress test error in look "${look.id}" on palette ${palette.join(",")}:`,
                errors
              );
            }
            expect(errors).toHaveLength(0);

            if (result.fixes && result.fixes.length > 0) {
              autofixCount++;
            }
          }
        }
      }

      console.log(
        `Stress test passed: ${totalRenders} cards rendered across 6 looks. ` +
        `Autofix applied: ${autofixCount} (${((autofixCount / totalRenders) * 100).toFixed(1)}%). ` +
        `Incompatible look/palette pairs filtered: ${incompatibleCount}.`
      );
      expect(totalRenders).toBeGreaterThan(3000);
    }, 20000);
  });
});
