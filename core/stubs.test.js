// @ts-check
import { describe, expect, it } from "vitest";
import { applyOperation, Issue, pickThree, renderCard, SceneNode } from "./index.js";
import { sampleDesignConfig, personNormal } from "./fixtures.js";

describe("core/stubs", () => {
  it("renderCard produces valid output in portrait and landscape", () => {
    // Portrait
    const portraitRes = renderCard({
      person: personNormal,
      card: { orientation: "portrait", widthMm: 54, heightMm: 85.6 },
    });
    expect(portraitRes.svg.startsWith("<svg")).toBe(true);
    expect(portraitRes.svg).toContain('viewBox="0 0 54 85.6"');
    expect(portraitRes.svg).toContain('width="54mm"');
    expect(portraitRes.svg).toContain('height="85.6mm"');
    portraitRes.scene.forEach((node) => expect(() => SceneNode.parse(node)).not.toThrow());
    portraitRes.issues.forEach((issue) => expect(() => Issue.parse(issue)).not.toThrow());

    // Landscape
    const landscapeRes = renderCard({
      person: personNormal,
      card: { orientation: "landscape", widthMm: 85.6, heightMm: 54 },
    });
    expect(landscapeRes.svg.startsWith("<svg")).toBe(true);
    expect(landscapeRes.svg).toContain('viewBox="0 0 85.6 54"');
  });

  it("applyOperation validates operations correctly", () => {
    const validOp = { op: "setDensity", value: "airy" };
    expect(applyOperation(sampleDesignConfig, validOp)).toEqual(sampleDesignConfig);

    const invalidOp = { op: "unknownOp" };
    expect(() => applyOperation(sampleDesignConfig, invalidOp)).toThrow();
  });

  it("pickThree returns three items", () => {
    const items = ["look.1", "look.2", "look.3", "look.4"];
    const result = pickThree(items);
    expect(result).toHaveLength(3);
    expect(result).toEqual(["look.1", "look.2", "look.3"]);

    // With look objects containing attributes
    const looks = [
      { id: "A", attributes: { skeleton: "s1", header: "h1", photo: "p1", marker: "m1", theme: "t1" }, tags: [] },
      { id: "B", attributes: { skeleton: "s2", header: "h2", photo: "p2", marker: "m2", theme: "t2" }, tags: [] },
      { id: "C", attributes: { skeleton: "s3", header: "h3", photo: "p3", marker: "m3", theme: "t3" }, tags: [] },
      { id: "D", attributes: { skeleton: "s1", header: "h1", photo: "p1", marker: "m1", theme: "t1" }, tags: [] },
    ];
    const picked = pickThree(looks);
    expect(picked).toHaveLength(3);
  });
});
