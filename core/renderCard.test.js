// @ts-check
import { describe, expect, it } from "vitest";
import { renderCard } from "./render.js";
import {
  personNormal,
  personNoPhoto,
  sampleBrandKit,
  sampleEventSpec,
} from "./fixtures.js";
import { Issue, SceneNode } from "./schemas.js";

describe("core/renderCard vertical slice", () => {
  const baseInput = {
    person: personNormal,
    event: sampleEventSpec,
    brand: sampleBrandKit,
    card: sampleEventSpec.card,
  };

  it("svg has the correct mm width, height and viewBox for portrait", () => {
    const res = renderCard(baseInput);
    expect(res.svg.startsWith("<svg")).toBe(true);
    expect(res.svg).toContain('width="54mm"');
    expect(res.svg).toContain('height="85.6mm"');
    expect(res.svg).toContain('viewBox="0 0 54 85.6"');
  });

  it("scene has a node for each drawn element, all ids unique, all boxes inside card", () => {
    const res = renderCard(baseInput);
    expect(res.scene.length).toBeGreaterThanOrEqual(8);

    const ids = res.scene.map((n) => n.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);

    for (const node of res.scene) {
      expect(() => SceneNode.parse(node)).not.toThrow();
      expect(node.box.x).toBeGreaterThanOrEqual(0);
      expect(node.box.y).toBeGreaterThanOrEqual(0);
      expect(node.box.x + node.box.w).toBeLessThanOrEqual(54.01);
      expect(node.box.y + node.box.h).toBeLessThanOrEqual(85.61);
    }
  });

  it("escapes special XML characters in text so SVG remains valid", () => {
    const res = renderCard({
      ...baseInput,
      person: { ...personNormal, name: "Aarav & Team <Dev>" },
    });
    expect(res.svg).toContain("Aarav &amp; Team &lt;Dev&gt;");
    expect(res.svg).not.toContain("Aarav & Team <Dev>");
    expect(res.svg.endsWith("</svg>")).toBe(true);
  });

  it("is deterministic: same input produces identical output", () => {
    const run1 = renderCard(baseInput);
    const run2 = renderCard(baseInput);
    expect(run1.svg).toBe(run2.svg);
    expect(run1.scene).toEqual(run2.scene);
  });

  it("renders a person with no photo without error", () => {
    const res = renderCard({
      ...baseInput,
      person: personNoPhoto,
    });
    expect(res.svg).toContain("<svg");
    const photoNode = res.scene.find((n) => n.id === "photo");
    expect(photoNode).toBeDefined();
  });

  it("renders two people with different roles and produces different names and colors", () => {
    const participantRes = renderCard({
      ...baseInput,
      person: personNormal, // participant -> #2563EB
    });

    const mentorPerson = {
      id: "HX26-M-002",
      name: "Mentor Vikram",
      roleId: "mentor", // mentor -> #16A34A
      flags: [],
      photo: null,
    };

    const mentorRes = renderCard({
      ...baseInput,
      person: mentorPerson,
    });

    expect(participantRes.svg).toContain(personNormal.name);
    expect(mentorRes.svg).toContain("Mentor Vikram");

    // Colors differ based on role
    expect(participantRes.svg).toContain("#2563EB");
    expect(mentorRes.svg).toContain("#16A34A");

    // Scene nodes reflect different colors and text
    const participantBand = participantRes.scene.find((n) => n.id === "band");
    const mentorBand = mentorRes.scene.find((n) => n.id === "band");
    expect(participantBand?.fill).toBe("#2563EB");
    expect(mentorBand?.fill).toBe("#16A34A");
  });
});
