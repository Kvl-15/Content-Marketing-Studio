// @ts-check
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import { fitText, measure, PT_TO_MM, wrap } from "./text.js";
import { renderCard } from "./render.js";
import {
  personLongName,
  personNormal,
  sampleBrandKit,
  sampleEventSpec,
} from "./fixtures.js";
import { loadContent } from "../scripts/loadContent.js";

const { skeletons, blocks, themes, looks } = loadContent();

// Load test font from assets/fonts
const fontPath = resolve(process.cwd(), "assets/fonts/Roboto-VariableFont_wdth,wght.ttf");
const fontBuf = readFileSync(fontPath);
const testFont = opentype.parse(
  fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength)
);

describe("core/text engine", () => {
  const boxWidthMm = 41.4; // 90% of 46mm info slot

  describe("measure", () => {
    it("returns 0 for empty string", () => {
      expect(measure("", 3.1752, testFont)).toBe(0);
    });

    it("reports longer text as wider", () => {
      const shortWidth = measure("Alex", 3.1752, testFont);
      const longWidth = measure("Alexander Montgomery", 3.1752, testFont);
      expect(longWidth).toBeGreaterThan(shortWidth);
    });

    it("reports larger font size as wider", () => {
      const smallSize = measure("Preet Patel", 2.0, testFont);
      const largeSize = measure("Preet Patel", 3.5, testFont);
      expect(largeSize).toBeGreaterThan(smallSize);
    });

    it("measures names containing & and accents without throwing", () => {
      const w1 = measure("Aarav & Dev", 3.1752, testFont);
      const w2 = measure("René François", 3.1752, testFont);
      expect(w1).toBeGreaterThan(0);
      expect(w2).toBeGreaterThan(0);
    });
  });

  describe("wrap", () => {
    it("fits a normal two-word name on one line when box is wide", () => {
      const lines = wrap("Preet Patel", 50, 3.1752, testFont);
      expect(lines).toEqual(["Preet Patel"]);
    });

    it("wraps a long name into 2 lines at spaces", () => {
      const lines = wrap("Dr. Anuradha Priyadarshini Mukherjee", 41.4, 3.1752, testFont);
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe("Dr. Anuradha Priyadarshini");
      expect(lines[1]).toBe("Mukherjee");
    });

    it("splits a 60-letter word with no spaces and no line exceeds the box", () => {
      const longWord = "A".repeat(60);
      const lines = wrap(longWord, 30, 3.1752, testFont, true);
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) {
        expect(measure(line, 3.1752, testFont)).toBeLessThanOrEqual(30.01);
      }
    });
  });

  describe("fitText (D-20)", () => {
    it("Preet Patel stays at 9 pt on one line", () => {
      const res = fitText({
        text: "Preet Patel",
        boxWidthMm,
        sizeRangePt: [9, 6.5],
        oneLineFloorPt: 7.5,
        maxLines: 2,
        font: testFont,
      });
      expect(res.status).toBe("ok");
      expect(res.lines).toEqual(["Preet Patel"]);
      expect(res.sizeMm / PT_TO_MM).toBeCloseTo(9, 0);
    });

    it("renders a name needing small shrink on ONE line between 7.5 and 9 pt", () => {
      // "Anuradha Priyadarshini Mukherjee" on one line exceeds 9 pt, fits at ~7.65 pt
      const res = fitText({
        text: "Anuradha Priyadarshini Mukherjee",
        boxWidthMm,
        sizeRangePt: [9, 6.5],
        oneLineFloorPt: 7.5,
        maxLines: 2,
        font: testFont,
      });
      expect(res.status).toBe("ok");
      expect(res.lines.length).toBe(1);
      const pt = res.sizeMm / PT_TO_MM;
      expect(pt).toBeGreaterThanOrEqual(7.5);
      expect(pt).toBeLessThanOrEqual(9.01);
    });

    it("splits a name needing more than shrink into exactly 2 lines above 7.5 pt", () => {
      const res = fitText({
        text: "Dr. Anuradha Priyadarshini Mukherjee",
        boxWidthMm,
        sizeRangePt: [9, 6.5],
        oneLineFloorPt: 7.5,
        maxLines: 2,
        font: testFont,
      });
      expect(res.status).toBe("ok");
      expect(res.lines.length).toBe(2);
      const pt = res.sizeMm / PT_TO_MM;
      expect(pt).toBeGreaterThan(7.5);
    });

    it("a single 28-letter word is shrunk, not split, if it fits at >= 6.5 pt", () => {
      const word28 = "Antidisestablishmentarianism";
      const res = fitText({
        text: word28,
        boxWidthMm,
        sizeRangePt: [9, 6.5],
        oneLineFloorPt: 7.5,
        maxLines: 2,
        font: testFont,
      });
      expect(res.status).toBe("ok");
      expect(res.lines).toEqual([word28]);
      const pt = res.sizeMm / PT_TO_MM;
      expect(pt).toBeGreaterThanOrEqual(6.5);
    });

    it("the 57-character fixture name returns status 'truncated', ends with '...', has at most 2 lines, size >= 6.5 pt", () => {
      const res = fitText({
        text: personLongName.name,
        boxWidthMm,
        sizeRangePt: [9, 6.5],
        oneLineFloorPt: 7.5,
        maxLines: 2,
        font: testFont,
      });
      expect(res.status).toBe("truncated");
      expect(res.lines.length).toBeLessThanOrEqual(2);
      expect(res.lines[res.lines.length - 1].endsWith("...")).toBe(true);
      expect(res.sizeMm / PT_TO_MM).toBeGreaterThanOrEqual(6.5);
      for (const line of res.lines) {
        expect(measure(line, res.sizeMm, testFont)).toBeLessThanOrEqual(boxWidthMm + 0.01);
      }
    });

    it("no name text node is ever below 6.5 pt or has more than 2 lines, no line wider than box", () => {
      const testNames = [
        "Preet Patel",
        "Anuradha Priyadarshini Mukherjee",
        "Dr. Anuradha Priyadarshini Mukherjee",
        "Antidisestablishmentarianism",
        personLongName.name,
        "A".repeat(100),
      ];

      for (const name of testNames) {
        const res = fitText({
          text: name,
          boxWidthMm,
          sizeRangePt: [9, 6.5],
          oneLineFloorPt: 7.5,
          maxLines: 2,
          font: testFont,
        });
        expect(res.lines.length).toBeLessThanOrEqual(2);
        expect(res.sizeMm / PT_TO_MM).toBeGreaterThanOrEqual(6.49);
        for (const line of res.lines) {
          expect(measure(line, res.sizeMm, testFont)).toBeLessThanOrEqual(boxWidthMm + 0.05);
        }
      }
    });
  });

  describe("renderCard with text fitting and issues", () => {
    it("emits a TEXT_TRUNCATED warning for personLongName", () => {
      const res = renderCard({
        person: personLongName,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        font: testFont,
        skeleton: skeletons.portrait,
        blocks,
        theme: themes["brand-blue"],
      });

      const nameNode = res.scene.find((n) => n.id === "name");
      expect(nameNode).toBeDefined();
      if (nameNode && nameNode.type === "text") {
        expect(nameNode.status).toBe("truncated");
        expect(nameNode.lines[nameNode.lines.length - 1].endsWith("...")).toBe(true);
        expect(nameNode.sizeMm / PT_TO_MM).toBeGreaterThanOrEqual(6.5);
        for (const line of nameNode.lines) {
          expect(measure(line, nameNode.sizeMm, testFont)).toBeLessThanOrEqual(nameNode.box.w + 0.01);
        }
      }

      const truncatedIssue = res.issues.find((i) => i.code === "TEXT_TRUNCATED" && i.nodeId === "name");
      expect(truncatedIssue).toBeDefined();
      expect(truncatedIssue?.severity).toBe("warning");
    });

    it("renders names with & and accents in valid XML and without issues", () => {
      const res = renderCard({
        person: { ...personNormal, name: "René & François" },
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        font: testFont,
        skeleton: skeletons.portrait,
        blocks,
        theme: themes["brand-blue"],
      });

      expect(res.svg).toContain("René &amp; François");
      expect(res.issues.length).toBe(0);
      const nameNode = res.scene.find((n) => n.id === "name");
      expect(nameNode?.type === "text" && nameNode.status).toBe("ok");
    });
  });
});
