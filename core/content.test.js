// @ts-check
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import { renderCard } from "./render.js";
import {
  personLongName,
  personNormal,
  sampleBrandKit,
  sampleEventSpec,
} from "./fixtures.js";
import {
  Block,
  BrandKit,
  Look,
  Skeleton,
  Theme,
} from "./schemas.js";
import { loadContent } from "../scripts/loadContent.js";

describe("Task 7A: Content and Golden Tests", () => {
  const content = loadContent();
  const fontPath = resolve(process.cwd(), "assets/fonts/Roboto-VariableFont_wdth,wght.ttf");
  const fontBuf = readFileSync(fontPath);
  const font = opentype.parse(
    fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength)
  );

  // (a) Byte-identical SVG output compared to golden files
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

  // (b) Every JSON file in content/ passes its schema
  describe("Content schema validation", () => {
    it("validates all skeletons against Skeleton schema", () => {
      expect(Object.keys(content.skeletons).length).toBeGreaterThan(0);
      for (const [id, skeleton] of Object.entries(content.skeletons)) {
        expect(() => Skeleton.parse(skeleton)).not.toThrow();
        expect(skeleton.id).toBe(id);
      }
    });

    it("validates all blocks against Block schema", () => {
      expect(Object.keys(content.blocks).length).toBeGreaterThanOrEqual(4);
      for (const [id, block] of Object.entries(content.blocks)) {
        expect(() => Block.parse(block)).not.toThrow();
        expect(block.id).toBe(id);
      }
    });

    it("validates all themes against Theme schema", () => {
      expect(Object.keys(content.themes).length).toBeGreaterThan(0);
      for (const [id, theme] of Object.entries(content.themes)) {
        expect(() => Theme.parse(theme)).not.toThrow();
        expect(theme.id).toBe(id);
      }
    });

    it("validates all looks against Look schema", () => {
      expect(Object.keys(content.looks).length).toBeGreaterThan(0);
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

  // (c) Cross-reference integrity
  describe("Cross-reference integrity", () => {
    it("every look refers to a skeleton, theme, and blocks that exist, with matching slots", () => {
      for (const [lookId, look] of Object.entries(content.looks)) {
        // Skeleton exists
        const skeleton = content.skeletons[look.skeleton];
        expect(skeleton, `Look "${lookId}" skeleton "${look.skeleton}" must exist`).toBeDefined();

        // Theme exists
        const theme = content.themes[look.theme];
        expect(theme, `Look "${lookId}" theme "${look.theme}" must exist`).toBeDefined();

        // Blocks exist and their slot exists in skeleton
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
});
