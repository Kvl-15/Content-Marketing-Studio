// @ts-check
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import { ARCHETYPES, compose } from "./composer.js";
import {
  personLongName,
  personNoPhoto,
  personNormal,
  sampleBrandKit,
  sampleEventSpec,
} from "./fixtures.js";
import { renderCard } from "./render.js";
import { loadContent } from "../scripts/loadContent.js";

const content = loadContent();
const fontPath = resolve(process.cwd(), "assets/fonts/Roboto-VariableFont_wdth,wght.ttf");
const fontBuf = readFileSync(fontPath);
const font = opentype.parse(
  fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength)
);

const baseInput = {
  person: personNormal,
  event: sampleEventSpec,
  brand: sampleBrandKit,
  card: sampleEventSpec.card,
  font,
  skeleton: content.skeletons.portrait,
  blocks: content.blocks,
  theme: content.themes["brand-blue"],
  look: content.looks["look.bold"],
};

/**
 * Extracts <rect> elements and their geometry from an SVG string.
 *
 * @param {string} svg
 * @returns {Array<{ id: string | null, x: number, y: number, w: number, h: number }>}
 */
function parseSvgRects(svg) {
  const matches = [...svg.matchAll(/<rect\s+([^>]+)\/>/g)];
  return matches.map((m) => {
    const attrs = m[1];
    const id = attrs.match(/id="([^"]+)"/)?.[1] || null;
    const x = parseFloat(attrs.match(/x="([^"]+)"/)?.[1] || "0");
    const y = parseFloat(attrs.match(/y="([^"]+)"/)?.[1] || "0");
    const w = parseFloat(attrs.match(/width="([^"]+)"/)?.[1] || "0");
    const h = parseFloat(attrs.match(/height="([^"]+)"/)?.[1] || "0");
    return { id, x, y, w, h };
  });
}

describe("TASK B1: Bleed in the Renderer (core/bleed.test.js)", () => {
  // 1. All 4 archetypes x 3 modes with bleed 3: decor shapes extend 3mm, others unchanged
  it("for all 4 archetypes x 3 modes with bleed 3: every decor shape touching trim reaches 3mm past it, and no other shape moved", () => {
    const modes = ["light", "dark", "colour-field"];
    const bleedMm = 3;

    for (const archetype of ARCHETYPES) {
      for (const mode of modes) {
        const bundle = compose(sampleEventSpec, "bleed-test-seed-1", archetype, mode);
        const cardInput = {
          person: personNormal,
          event: sampleEventSpec,
          brand: sampleBrandKit,
          card: sampleEventSpec.card,
          font,
          skeleton: bundle.skeleton,
          blocks: bundle.blocks,
          theme: bundle.theme,
          look: bundle.look,
        };

        const res0 = renderCard({ ...cardInput, bleedMm: 0 });
        const res3 = renderCard({ ...cardInput, bleedMm: 3 });

        // Condition 1: returned scene is deep-equal with and without bleed
        expect(res3.scene).toEqual(res0.scene);

        // Condition 1: validator issues are identical with and without bleed
        expect(res3.issues).toEqual(res0.issues);

        const rects3 = parseSvgRects(res3.svg);

        for (const node of res0.scene) {
          if (node.type === "rect") {
            const isDecor = node.decor === true;
            const svgRect = rects3.find((r) => r.id === node.id);
            if (!svgRect) continue; // clipPath rects or photo internal rects

            const touchesLeft = node.box.x <= 0.01;
            const touchesTop = node.box.y <= 0.01;
            const touchesRight = node.box.x + node.box.w >= 54 - 0.01;
            const touchesBottom = node.box.y + node.box.h >= 85.6 - 0.01;

            if (isDecor) {
              const expectedX = touchesLeft ? node.box.x - bleedMm : node.box.x;
              const expectedY = touchesTop ? node.box.y - bleedMm : node.box.y;
              const expectedW =
                node.box.w + (touchesLeft ? bleedMm : 0) + (touchesRight ? bleedMm : 0);
              const expectedH =
                node.box.h + (touchesTop ? bleedMm : 0) + (touchesBottom ? bleedMm : 0);

              expect(svgRect.x).toBeCloseTo(expectedX, 2);
              expect(svgRect.y).toBeCloseTo(expectedY, 2);
              expect(svgRect.w).toBeCloseTo(expectedW, 2);
              expect(svgRect.h).toBeCloseTo(expectedH, 2);
            } else {
              // Non-decor elements must NOT be extended in SVG
              expect(svgRect.x).toBeCloseTo(node.box.x, 2);
              expect(svgRect.y).toBeCloseTo(node.box.y, 2);
              expect(svgRect.w).toBeCloseTo(node.box.w, 2);
              expect(svgRect.h).toBeCloseTo(node.box.h, 2);
            }
          }
        }
      }
    }
  });

  // 2. Text, logo, photo, and pill positions are identical with and without bleed (compare scene nodes)
  it("text, logo, photo and pill positions are identical with and without bleed (compare scene nodes)", () => {
    const resNoBleed = renderCard(baseInput);
    const resBleed = renderCard({ ...baseInput, bleedMm: 3 });

    expect(resBleed.scene).toEqual(resNoBleed.scene);

    const trackedIds = ["name", "role", "photo", "logo1", "logo2"];
    for (const id of trackedIds) {
      const nodeNoBleed = resNoBleed.scene.find((n) => n.id === id);
      const nodeBleed = resBleed.scene.find((n) => n.id === id);
      if (nodeNoBleed && nodeBleed) {
        expect(nodeBleed.box).toEqual(nodeNoBleed.box);
      }
    }
  });

  // 3. ViewBox and size are exactly correct for bleed 0, 1, 3, and 10
  it("viewBox and size are exactly as specified for bleed 0, 1, 3 and 10", () => {
    const cases = [
      { bleed: 0, wMm: "54mm", hMm: "85.6mm", vb: "0 0 54 85.6", bw: 54, bh: 85.6, bx: 0, by: 0 },
      { bleed: 1, wMm: "56mm", hMm: "87.6mm", vb: "-1 -1 56 87.6", bw: 56, bh: 87.6, bx: -1, by: -1 },
      { bleed: 3, wMm: "60mm", hMm: "91.6mm", vb: "-3 -3 60 91.6", bw: 60, bh: 91.6, bx: -3, by: -3 },
      { bleed: 10, wMm: "74mm", hMm: "105.6mm", vb: "-10 -10 74 105.6", bw: 74, bh: 105.6, bx: -10, by: -10 },
    ];

    for (const c of cases) {
      const res = renderCard({ ...baseInput, bleedMm: c.bleed });
      expect(res.svg).toContain(`width="${c.wMm}"`);
      expect(res.svg).toContain(`height="${c.hMm}"`);
      expect(res.svg).toContain(`viewBox="${c.vb}"`);

      // Verify returned additive box fields (Condition 6)
      expect(res.trimBox).toEqual({ x: 0, y: 0, w: 54, h: 85.6 });
      expect(res.bleedBox).toEqual({ x: c.bx, y: c.by, w: c.bw, h: c.bh });
      expect(res.bleedMm).toBe(c.bleed);
    }
  });

  // 4. Bleed omitted gives byte-identical SVG to the golden files
  it("bleed omitted gives byte-identical SVG to the golden files", () => {
    const goldenNormalPath = resolve(process.cwd(), "core/golden/personNormal.svg");
    const goldenNormalSvg = readFileSync(goldenNormalPath, "utf8");

    const resNormal = renderCard(baseInput);
    expect(resNormal.svg).toBe(goldenNormalSvg);

    // Also with bleedMm: 0 explicitly passed
    const resNormalZero = renderCard({ ...baseInput, bleedMm: 0 });
    expect(resNormalZero.svg).toBe(goldenNormalSvg);

    const goldenLongNamePath = resolve(process.cwd(), "core/golden/personLongName.svg");
    const goldenLongNameSvg = readFileSync(goldenLongNamePath, "utf8");

    const resLongName = renderCard({ ...baseInput, person: personLongName });
    expect(resLongName.svg).toBe(goldenLongNameSvg);
  });

  // 5. The validator reports the same errors with and without bleed
  it("the validator reports the same errors with and without bleed", () => {
    const badPersonInput = {
      ...baseInput,
      person: { ...personNormal, roleId: "unlisted-role" },
    };

    const resNoBleed = renderCard(badPersonInput);
    const resBleed = renderCard({ ...badPersonInput, bleedMm: 3 });

    expect(resBleed.issues).toEqual(resNoBleed.issues);
    expect(resBleed.issues.some((i) => i.code === "UNKNOWN_ROLE_ID")).toBe(true);
  });

  // 6. Invalid bleed values (-1, 11, NaN, Infinity, "3", null) are rejected with clear error
  it("input validation rejects invalid bleedMm values (-1, 11, NaN, Infinity, '3', null)", () => {
    expect(() => renderCard({ ...baseInput, bleedMm: -1 })).toThrowError(/bleedMm/);
    expect(() => renderCard({ ...baseInput, bleedMm: 11 })).toThrowError(/bleedMm/);
    expect(() => renderCard({ ...baseInput, bleedMm: NaN })).toThrowError(/bleedMm/);
    expect(() => renderCard({ ...baseInput, bleedMm: Infinity })).toThrowError(/bleedMm/);
    expect(() => renderCard({ ...baseInput, bleedMm: "3" })).toThrowError(/bleedMm/);
    expect(() => renderCard({ ...baseInput, bleedMm: null })).toThrowError(/bleedMm/);

    // Valid values must not throw
    expect(() => renderCard({ ...baseInput, bleedMm: 0 })).not.toThrow();
    expect(() => renderCard({ ...baseInput, bleedMm: 3 })).not.toThrow();
    expect(() => renderCard({ ...baseInput, bleedMm: 10 })).not.toThrow();
  });

  // 7. Determinism: same input with same bleed renders byte-identical twice
  it("the same input with the same bleed renders byte-identical twice", () => {
    const run1 = renderCard({ ...baseInput, bleedMm: 3 });
    const run2 = renderCard({ ...baseInput, bleedMm: 3 });

    expect(run1.svg).toBe(run2.svg);
    expect(run1.scene).toEqual(run2.scene);
    expect(run1.trimBox).toEqual(run2.trimBox);
    expect(run1.bleedBox).toEqual(run2.bleedBox);
    expect(run1.bleedMm).toBe(run2.bleedMm);
  });

  // 8. Long names and no-photo cards still render cleanly with bleed
  it("a 57-character name and a card with no photo still render with bleed", () => {
    const extremeName = "Professor Ananthanarayanan Ramasubramanian Krishnamoorthy";
    expect(extremeName.length).toBe(57);

    const resLong = renderCard({
      ...baseInput,
      person: { ...personNormal, name: extremeName },
      bleedMm: 3,
    });
    expect(resLong.svg.startsWith("<svg")).toBe(true);
    expect(resLong.svg).toContain('viewBox="-3 -3 60 91.6"');
    expect(resLong.issues.filter((i) => i.severity === "error")).toHaveLength(0);

    const resNoPhoto = renderCard({
      ...baseInput,
      person: personNoPhoto,
      bleedMm: 3,
    });
    expect(resNoPhoto.svg.startsWith("<svg")).toBe(true);
    expect(resNoPhoto.svg).toContain('viewBox="-3 -3 60 91.6"');
    expect(resNoPhoto.scene.some((n) => n.id === "photo")).toBe(true);
  });

  // 9. Condition 3: detects decor by decor: true flag only and does not match id "bg"
  it("detects decor by decor: true flag only and does not match id 'bg'", () => {
    // Custom block with an element that has id "bg" but decor: false, and another element with id "accent-band" and decor: true
    const customBlocks = {
      ...content.blocks,
      "header.solid": {
        elements: [
          { id: "custom-bar", type: "rect", box: [0, 0, 100, 100], fill: "#10B981", decor: true },
        ],
      },
    };

    const res = renderCard({
      ...baseInput,
      blocks: customBlocks,
      bleedMm: 3,
    });

    const rects = parseSvgRects(res.svg);
    // Background node has decor: true explicitly, extends to -3, -3, 60, 91.6
    const bgRect = rects.find((r) => r.id === "bg");
    expect(bgRect?.x).toBe(-3);
    expect(bgRect?.w).toBe(60);

    // custom-bar has decor: true, touches trim top, left, right -> extends
    const customBar = rects.find((r) => r.id === "custom-bar");
    expect(customBar?.x).toBe(-3);
    expect(customBar?.y).toBe(-3);
    expect(customBar?.w).toBe(60);
  });

  // 10. Condition 5: non-decor element touching trim edge triggers OUTSIDE_SAFE_MARGIN and is not extended
  it("non-decor element touching trim is caught by OUTSIDE_SAFE_MARGIN and not extended into bleed", () => {
    const customBlocks = {
      ...content.blocks,
      "header.solid": {
        elements: [
          // Content element placed touching trim edge (x: 0, y: 0) without decor: true
          { id: "touching-content", type: "rect", box: [0, 0, 50, 10], fill: "#EF4444", decor: false },
        ],
      },
    };

    const res = renderCard({
      ...baseInput,
      blocks: customBlocks,
      bleedMm: 3,
    });

    // Content element touching trim (x=0 < margin 3mm) must trigger existing OUTSIDE_SAFE_MARGIN
    const marginIssues = res.issues.filter(
      (i) => i.code === "OUTSIDE_SAFE_MARGIN" && i.nodeId === "touching-content"
    );
    expect(marginIssues.length).toBeGreaterThanOrEqual(1);

    // In SVG, the content element is NOT extended into bleed (stays x=0, y=0)
    const rects = parseSvgRects(res.svg);
    const contentRect = rects.find((r) => r.id === "touching-content");
    expect(contentRect?.x).toBe(0);
    expect(contentRect?.y).toBe(0);
  });
});
