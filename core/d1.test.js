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
import { validate } from "./validate.js";
import { loadContent } from "../scripts/loadContent.js";

describe("Task D1: Rendering Foundations", () => {
  const content = loadContent();
  const fontPath = resolve(process.cwd(), "assets/fonts/Roboto-VariableFont_wdth,wght.ttf");
  const fontBuf = readFileSync(fontPath);
  const font = opentype.parse(
    fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength)
  );

  const baseInput = {
    person: personNormal,
    event: sampleEventSpec,
    brand: content.brandKits["test-logos"] || sampleBrandKit,
    card: sampleEventSpec.card,
    skeleton: content.skeletons.portrait,
    blocks: content.blocks,
    theme: content.themes["brand-blue"],
    look: content.looks["look.bold"],
    font,
  };

  // (a) render output contains NO <text> elements and NO font-family
  it("(a) render output contains NO <text> elements and NO font-family", () => {
    const res = renderCard(baseInput);
    expect(res.svg).not.toMatch(/<text[\s>]/);
    expect(res.svg).not.toContain("</text>");
    expect(res.svg).not.toContain("font-family");
  });

  // (b) render output contains <path> elements with d="..." inside <g id="..." aria-label="...">
  it('(b) render output contains <path> elements with d="..." inside <g id="..." aria-label="...">', () => {
    const res = renderCard(baseInput);
    expect(res.svg).toMatch(/<g id="name" aria-label="Preet Patel"><path d="M[^"]+" fill="[^"]+"\/?><\/g>/);
    expect(res.svg).toMatch(/<g id="role" aria-label="PARTICIPANT"><path d="M[^"]+" fill="[^"]+"\/?><\/g>/);
  });

  // (c) TEXT_UNSUPPORTED_GLYPH triggers on a character that does not exist in the font and passes on Latin with accents
  it("(c) TEXT_UNSUPPORTED_GLYPH triggers on missing characters and passes on Latin with accents", () => {
    // Failing case: Devanagari character missing in Roboto
    const failingScene = [
      {
        type: "text",
        id: "name",
        box: { x: 5, y: 10, w: 40, h: 10 },
        lines: ["नमस्ते"], // Devanagari "Namaste"
        sizeMm: 4,
        font: "Roboto",
        fill: "#000000",
        anchor: "start",
        status: "ok",
      },
    ];
    const failingIssues = validate(failingScene, { font });
    const unsupportedIssue = failingIssues.find((i) => i.code === "TEXT_UNSUPPORTED_GLYPH");
    expect(unsupportedIssue).toBeDefined();
    expect(unsupportedIssue?.severity).toBe("error");
    expect(unsupportedIssue?.nodeId).toBe("name");

    // Passing case: Latin characters with accents (é, ñ) present in Roboto
    const passingScene = [
      {
        type: "text",
        id: "name",
        box: { x: 5, y: 10, w: 40, h: 10 },
        lines: ["René Peña"],
        sizeMm: 4,
        font: "Roboto",
        fill: "#000000",
        anchor: "start",
        status: "ok",
      },
    ];
    const passingIssues = validate(passingScene, { font });
    const passingUnsupported = passingIssues.find((i) => i.code === "TEXT_UNSUPPORTED_GLYPH");
    expect(passingUnsupported).toBeUndefined();
  });

  // (d) logo on dark background with plate: "auto" renders a white plate rect behind the image
  it('(d) logo on dark background with plate: "auto" renders a white plate rect behind the image', () => {
    const res = renderCard({
      ...baseInput,
      look: content.looks["look.bold"], // header.solid has dark role band (#2563EB)
    });

    const plateNode = res.scene.find((n) => n.id === "logo1-plate");
    expect(plateNode).toBeDefined();
    expect(plateNode?.type).toBe("rect");
    expect(plateNode?.decor).toBe(true);
    expect(plateNode?.fill).toBe("#FFFFFF");

    expect(res.svg).toContain('<rect id="logo1-plate"');
    expect(res.svg).toContain('fill="#FFFFFF"');
  });

  // (e) logo on near-white background with plate: "auto" renders NO plate
  it('(e) logo on near-white background with plate: "auto" renders NO plate', () => {
    const res = renderCard({
      ...baseInput,
      look: content.looks["look.minimal"], // header.thin-line on near-white card
      theme: {
        id: "pure-white",
        colors: {
          background: "#FFFFFF",
          text: "#111827",
          accent: "#2563EB",
        },
        fonts: {
          heading: "Roboto",
          body: "Roboto",
        },
      },
    });

    const plateNode = res.scene.find((n) => n.id === "logo1-plate");
    expect(plateNode).toBeUndefined();
    expect(res.svg).not.toContain("logo1-plate");
  });

  // (f) missing photo file renders silhouette placeholder
  it("(f) missing photo file renders silhouette placeholder", () => {
    const res = renderCard({
      ...baseInput,
      person: { ...personNormal, photo: "missing-alex.jpg" }, // has photo field, but not a data URI
    });

    const photoNode = res.scene.find((n) => n.id === "photo");
    expect(photoNode).toBeDefined();
    expect(photoNode?.photoMode).toBe("silhouette");
    expect(photoNode?.decor).toBeUndefined(); // content node, not decor

    expect(res.svg).toContain('<clipPath id="clip-photo">');
    expect(res.svg).toContain('fill="#94A3B8"');

    // No NO_PHOTO warning since photo field is present
    const noPhotoWarn = res.issues.find((i) => i.code === "NO_PHOTO");
    expect(noPhotoWarn).toBeUndefined();
  });

  // (g) person with photo: null renders initials avatar AND emits NO_PHOTO warning
  it("(g) person with photo: null renders initials avatar AND emits NO_PHOTO warning", () => {
    const res = renderCard({
      ...baseInput,
      person: { ...personNormal, photo: null },
    });

    const photoNode = res.scene.find((n) => n.id === "photo");
    expect(photoNode).toBeDefined();
    expect(photoNode?.photoMode).toBe("initials");
    expect(photoNode?.initials).toBe("PP"); // Preet Patel -> PP
    expect(photoNode?.decor).toBeUndefined(); // content node, not decor

    expect(res.svg).toContain('<g id="photo">');
    expect(res.svg).toMatch(/<g id="photo"><rect[^>]+fill="#E5E7EB"[^>]*\/><path d="M[^"]+" fill="#475569"\/?><\/g>/);

    // Emits NO_PHOTO warning
    const noPhotoWarn = res.issues.find((i) => i.code === "NO_PHOTO");
    expect(noPhotoWarn).toBeDefined();
    expect(noPhotoWarn?.severity).toBe("warning");
  });

  // (h) golden tests: re-render personNormal and personLongName match byte-identical
  it("(h) golden tests: re-render personNormal and personLongName match byte-identical", () => {
    const goldenNormal = readFileSync(resolve(process.cwd(), "core/golden/personNormal.svg"), "utf8");
    const goldenLong = readFileSync(resolve(process.cwd(), "core/golden/personLongName.svg"), "utf8");

    const resNormal = renderCard({
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

    const resLong = renderCard({
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

    expect(resNormal.svg).toBe(goldenNormal);
    expect(resLong.svg).toBe(goldenLong);
  });

  // (i) all looks x palettes x persons validate with zero errors
  it("(i) all 6 looks x 6 palettes x 3 persons validate with zero errors", () => {
    const palettes = [
      ["#0A192F", "#FF6B35"],
      ["#1E3A2F", "#F5EBE0"],
      ["#4A154B", "#E01E5A"],
      ["#DC2626", "#18181B"],
      ["#0D9488", "#FBBF24"],
      ["#BAE6FD", "#FBCFE8"],
    ];
    const persons = [personNormal, personLongName, personNoPhoto];

    let renderCount = 0;
    for (const look of Object.values(content.looks)) {
      const skeleton = content.skeletons[look.skeleton];
      for (const pal of palettes) {
        for (const person of persons) {
          const res = renderCard({
            person,
            event: sampleEventSpec,
            brand: content.brandKits["test-logos"] || sampleBrandKit,
            card: sampleEventSpec.card,
            skeleton,
            blocks: content.blocks,
            look,
            palette: pal,
            font,
          });

          const errors = res.issues.filter((i) => i.severity === "error");
          expect(errors, `Errors in look "${look.id}" with person "${person.id}": ${errors.map((e) => e.message).join("; ")}`).toHaveLength(0);
          renderCount++;
        }
      }
    }
    expect(renderCount).toBe(6 * 6 * 3); // 108 total combinations
  });
});
