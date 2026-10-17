// @ts-check
import { describe, expect, it } from "vitest";
import { autofix, getTextFloorPt } from "./autofix.js";
import { renderCard } from "./render.js";
import {
  BlockElement,
  RectBlockElement,
  RectNode,
  SceneNode,
  TextBlockElement,
  TextNode,
} from "./schemas.js";
import { PT_TO_MM } from "./text.js";

const mockFont = {
  getAdvanceWidth: (text, sizeMm) => text.length * sizeMm * 0.6,
  unitsPerEm: 1000,
  charToGlyph: () => ({ advanceWidth: 600 }),
};

describe("Task 6: Autofix", () => {
  // 1. Schema tests: optional flag on BlockElement and SceneNode
  describe("Schema optional field (D-23)", () => {
    it("validates BlockElement with and without optional flag", () => {
      const withOptional = {
        id: "badge",
        type: "rect",
        box: [0, 0, 10, 10],
        fill: "#FFFFFF",
        optional: true,
      };
      const withoutOptional = {
        id: "badge",
        type: "rect",
        box: [0, 0, 10, 10],
        fill: "#FFFFFF",
      };
      expect(RectBlockElement.safeParse(withOptional).success).toBe(true);
      expect(RectBlockElement.safeParse(withoutOptional).success).toBe(true);
      expect(BlockElement.safeParse(withOptional).success).toBe(true);
      expect(BlockElement.safeParse(withoutOptional).success).toBe(true);
    });

    it("validates SceneNode with and without optional flag", () => {
      const nodeWithOptional = {
        type: "rect",
        id: "accent",
        box: { x: 10, y: 10, w: 20, h: 20 },
        fill: "#3B82F6",
        optional: true,
      };
      const nodeWithoutOptional = {
        type: "rect",
        id: "accent",
        box: { x: 10, y: 10, w: 20, h: 20 },
        fill: "#3B82F6",
      };
      expect(RectNode.safeParse(nodeWithOptional).success).toBe(true);
      expect(RectNode.safeParse(nodeWithoutOptional).success).toBe(true);
      expect(SceneNode.safeParse(nodeWithOptional).success).toBe(true);
      expect(SceneNode.safeParse(nodeWithoutOptional).success).toBe(true);
    });
  });

  // 2. LOW_CONTRAST fixed by color repair with zero errors left
  it("an input with LOW_CONTRAST gets fixed by the color repair, with zero errors left", () => {
    const scene = [
      {
        type: "rect",
        id: "bg",
        box: { x: 0, y: 0, w: 54, h: 85.6 },
        fill: "#FFFFFF",
        decor: true,
      },
      {
        type: "text",
        id: "role",
        box: { x: 5, y: 60, w: 44, h: 10 },
        lines: ["ATTENDEE"],
        sizeMm: 4 * PT_TO_MM,
        font: "sans-serif",
        fill: "#E5E7EB", // very low contrast against #FFFFFF
        anchor: "middle",
        status: "ok",
      },
    ];

    const result = autofix({
      scene,
      theme: { colors: { background: "#FFFFFF", text: "#111827", accent: "#2563EB" } },
    });

    const roleNode = result.scene.find((n) => n.id === "role");
    expect(roleNode.fill).toBe("#111827");
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors.length).toBe(0);
    expect(result.fixes).toEqual([
      {
        code: "LOW_CONTRAST",
        nodeId: "role",
        action: "Changed text fill to #111827",
      },
    ]);
  });

  // 3. TEXT_OVERFLOW on non-name text fixed by repair a, never below 5 pt
  it("a TEXT_OVERFLOW case on non-name text gets fixed by repair a, never below 5 pt", () => {
    // Non-name text with declared minimum 6 pt (start 8 pt). Box width 20 mm.
    // At 6 pt (6 * 0.3528 = 2.1168 mm): text width = 14 chars * 2.1168 * 0.6 = 17.78 mm (fits width).
    // Height of 2 lines = 1.25 * 2.1168 + 2.1168 = 4.76 mm > box.h (4.5 mm) -> overflows at 6 pt.
    // Lowered to 5 pt (5 * 0.3528 = 1.764 mm): height = 1.25 * 1.764 + 1.764 = 3.97 mm <= 4.5 mm -> fits!
    const scene = [
      {
        type: "rect",
        id: "bg",
        box: { x: 0, y: 0, w: 54, h: 85.6 },
        fill: "#FFFFFF",
        decor: true,
      },
      {
        type: "text",
        id: "role",
        box: { x: 5, y: 60, w: 44, h: 4.5 },
        lines: ["SENIOR LEAD", "ORGANIZER"],
        sizeMm: 6 * PT_TO_MM,
        font: "sans-serif",
        fill: "#111827",
        anchor: "middle",
        status: "ok",
        declaredMinPt: 6,
      },
    ];

    const input = {
      scene,
      font: mockFont,
      blocks: {
        info: {
          id: "info",
          slot: "info",
          elements: [
            {
              id: "role",
              type: "text",
              bind: "role.label",
              size: [8, 6],
              maxLines: 2,
              box: [0, 0, 100, 100],
              font: "body",
              align: "center",
            },
          ],
        },
      },
    };

    const result = autofix(input);
    const roleNode = result.scene.find((n) => n.id === "role");
    expect(roleNode.sizeMm / PT_TO_MM).toBeGreaterThanOrEqual(5 - 0.01);
    const errors = result.issues.filter((i) => i.severity === "error");
    expect(errors.length).toBe(0);
    expect(result.fixes.some((f) => f.code === "TEXT_OVERFLOW" && f.nodeId === "role")).toBe(true);
  });

  // 4. NAME text is never lowered below 6.5 pt even when it would otherwise overflow
  it("NAME text is never below 6.5 pt after autofix, even when it would otherwise overflow (the error stays instead)", () => {
    // Name text bound to person.name, currently at 6.5 pt, overflowing in a tiny box
    const scene = [
      {
        type: "rect",
        id: "bg",
        box: { x: 0, y: 0, w: 54, h: 85.6 },
        fill: "#FFFFFF",
        decor: true,
      },
      {
        type: "text",
        id: "name",
        bind: "person.name",
        box: { x: 5, y: 30, w: 10, h: 2 }, // tiny box impossible to fit
        lines: ["Alexander Montgomery Bartholomew"],
        sizeMm: 6.5 * PT_TO_MM,
        font: "sans-serif",
        fill: "#111827",
        anchor: "middle",
        status: "ok",
      },
    ];

    const input = {
      scene,
      font: mockFont,
      blocks: {
        info: {
          id: "info",
          slot: "info",
          elements: [
            {
              id: "name",
              type: "text",
              bind: "person.name",
              size: [9, 6.5],
              maxLines: 2,
              box: [0, 0, 100, 100],
              font: "heading",
              align: "center",
            },
          ],
        },
      },
    };

    const result = autofix(input);
    const nameNode = result.scene.find((n) => n.id === "name");
    expect(nameNode.sizeMm / PT_TO_MM).toBeGreaterThanOrEqual(6.5 - 0.001);
    const errors = result.issues.filter((i) => i.severity === "error" && i.code === "TEXT_OVERFLOW");
    expect(errors.length).toBeGreaterThan(0);
  });

  // 5. Test with declared minimum 4 pt proving the floor stays 4 pt
  it("proves declared minimum 4 pt floor stays 4 pt and is never raised to 5 pt", () => {
    const node = {
      id: "detail",
      type: "text",
      bind: "event.venue",
      sizeMm: 4 * PT_TO_MM,
      box: { x: 0, y: 0, w: 50, h: 10 },
    };
    const input = {
      blocks: {
        custom: {
          elements: [
            { id: "detail", type: "text", bind: "event.venue", size: [6, 4], maxLines: 1 },
          ],
        },
      },
    };

    const floor = getTextFloorPt(node, input);
    expect(floor).toBe(4);
  });

  // 6. Unfixable error (LOGO_MISSING or UNFILLED_DATA) stays an error and text content is unchanged
  it("an unfixable error (LOGO_MISSING or UNFILLED_DATA) stays an error and the text content is unchanged", () => {
    const scene = [
      {
        type: "rect",
        id: "bg",
        box: { x: 0, y: 0, w: 54, h: 85.6 },
        fill: "#FFFFFF",
        decor: true,
      },
      {
        type: "text",
        id: "name",
        bind: "person.name",
        box: { x: 5, y: 30, w: 44, h: 10 },
        lines: ["John $unfilled.role Doe"],
        sizeMm: 7 * PT_TO_MM,
        font: "sans-serif",
        fill: "#111827",
        anchor: "middle",
        status: "ok",
      },
    ];

    const brand = {
      logos: {
        primary: { file: "primary.svg", minWidthMm: 15, clearSpaceMm: 2 },
      },
    };

    const result = autofix({ scene, brand });
    const errors = result.issues.filter((i) => i.severity === "error");
    const errorCodes = errors.map((e) => e.code);
    expect(errorCodes).toContain("UNFILLED_DATA");
    expect(errorCodes).toContain("LOGO_MISSING");

    const textNode = result.scene.find((n) => n.id === "name");
    expect(textNode.lines).toEqual(["John $unfilled.role Doe"]);
  });

  // 7. Clean card is returned unchanged with an empty fixes list
  it("a clean card is returned unchanged with an empty fixes list", () => {
    const scene = [
      {
        type: "rect",
        id: "bg",
        box: { x: 0, y: 0, w: 54, h: 85.6 },
        fill: "#FFFFFF",
        decor: true,
      },
      {
        type: "text",
        id: "name",
        bind: "person.name",
        box: { x: 5, y: 30, w: 44, h: 10 },
        lines: ["Valid User"],
        sizeMm: 7 * PT_TO_MM,
        font: "sans-serif",
        fill: "#111827",
        anchor: "middle",
        status: "ok",
      },
    ];

    const result = autofix({ scene });
    expect(result.fixes).toEqual([]);
    expect(result.scene).toEqual(scene);
  });

  // 8. Running autofix twice gives the same result as once (idempotent)
  it("running autofix twice gives the same result as once", () => {
    const scene = [
      {
        type: "rect",
        id: "bg",
        box: { x: 0, y: 0, w: 54, h: 85.6 },
        fill: "#FFFFFF",
        decor: true,
      },
      {
        type: "text",
        id: "role",
        box: { x: 5, y: 60, w: 44, h: 10 },
        lines: ["PARTICIPANT"],
        sizeMm: 5 * PT_TO_MM,
        font: "sans-serif",
        fill: "#E5E7EB", // low contrast
        anchor: "middle",
        status: "ok",
      },
    ];

    const run1 = autofix({ scene });
    const run2 = autofix({ scene: run1.scene, issues: run1.issues });

    expect(run2.scene).toEqual(run1.scene);
    expect(run2.issues).toEqual(run1.issues);
    expect(run2.fixes).toEqual([]);
  });

  // 9. A repair that makes things worse is undone
  it("a repair that makes things worse is undone", () => {
    // If a candidate repair introduces another error or doesn't reduce errors, it is reverted
    const scene = [
      {
        type: "rect",
        id: "bg",
        box: { x: 0, y: 0, w: 54, h: 85.6 },
        fill: "#FFFFFF",
        decor: true,
      },
      {
        type: "text",
        id: "role",
        box: { x: 5, y: 60, w: 44, h: 10 },
        lines: ["TEST"],
        sizeMm: 6 * PT_TO_MM,
        font: "sans-serif",
        fill: "#777777", // contrast ~4.48 against white
        anchor: "middle",
        status: "ok",
      },
    ];

    // Background is #FFFFFF. #FFFFFF against #FFFFFF gives 1:1 contrast (worse!).
    // #111827 gives high contrast (>15:1).
    // Autofix tests candidates and only keeps one that improves.
    const result = autofix({ scene });
    const roleNode = result.scene.find((n) => n.id === "role");
    expect(roleNode.fill).toBe("#111827");
  });

  // 10. Decor node is NEVER hidden, but optional node IS hidden
  it("a decor node without optional: true is never hidden; optional node with optional: true is hidden", () => {
    const scene = [
      {
        type: "rect",
        id: "bg",
        box: { x: 0, y: 0, w: 54, h: 85.6 },
        fill: "#FFFFFF",
        decor: true,
      },
      {
        type: "rect",
        id: "band",
        box: { x: 0, y: 0, w: 54, h: 26 },
        fill: "#2563EB",
        decor: true, // decor must NEVER be hidden
      },
      {
        type: "rect",
        id: "extra-icon",
        box: { x: 10, y: 30, w: 20, h: 20 },
        fill: "#10B981",
        optional: true, // optional CAN be hidden
      },
      {
        type: "text",
        id: "name",
        bind: "person.name",
        box: { x: 10, y: 30, w: 20, h: 20 }, // overlaps with extra-icon
        lines: ["Alice"],
        sizeMm: 7 * PT_TO_MM,
        font: "sans-serif",
        fill: "#111827",
        anchor: "middle",
        status: "ok",
      },
    ];

    const result = autofix({ scene });
    // extra-icon was optional and caused overlap -> should be hidden
    expect(result.scene.some((n) => n.id === "extra-icon")).toBe(false);
    // band was decor -> must NOT be hidden
    expect(result.scene.some((n) => n.id === "band")).toBe(true);
    // bg was decor -> must NOT be hidden
    expect(result.scene.some((n) => n.id === "bg")).toBe(true);
    expect(result.fixes.some((f) => f.nodeId === "extra-icon")).toBe(true);
  });

  // 11. Density stub does not appear in fixes
  it("density stub does not appear in fixes list", () => {
    const scene = [
      {
        type: "rect",
        id: "bg",
        box: { x: 0, y: 0, w: 54, h: 85.6 },
        fill: "#FFFFFF",
        decor: true,
      },
      {
        type: "text",
        id: "name",
        bind: "person.name",
        box: { x: 5, y: 30, w: 44, h: 10 },
        lines: ["Valid User"],
        sizeMm: 7 * PT_TO_MM,
        font: "sans-serif",
        fill: "#111827",
        anchor: "middle",
        status: "ok",
      },
    ];

    const result = autofix({ scene });
    expect(result.fixes.some((f) => f.code === "setDensity")).toBe(false);
  });

  // 12. Integration with renderCard returns fixes additively
  it("renderCard returns fixes list additively alongside svg, scene, and issues", () => {
    const result = renderCard({
      person: { id: "P-1", name: "Test User", roleId: "participant", flags: [] },
    });
    expect(result).toHaveProperty("svg");
    expect(result).toHaveProperty("scene");
    expect(result).toHaveProperty("issues");
    expect(result).toHaveProperty("fixes");
    expect(Array.isArray(result.fixes)).toBe(true);
  });
});
