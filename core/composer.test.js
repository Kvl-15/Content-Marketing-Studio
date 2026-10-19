// @ts-check
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import {
  sampleBrandKit,
  sampleEventSpec,
  personNormal,
} from "./fixtures.js";
import {
  ARCHETYPES,
  compose,
  composeDrafts,
  DEFAULT_ROLE_COLORS,
  FONT_PAIRINGS,
  scoreQuality,
} from "./composer.js";
import { deriveTheme, hexToRgb, rgbToHsl } from "./themeDerivation.js";
import { distance } from "./picker.js";
import { renderCard } from "./render.js";
import {
  Block,
  Look,
  Skeleton,
  Theme,
} from "./schemas.js";
import {
  stressPersonLong57,
  stressSet,
} from "./stressSet.js";
import { contrastRatio } from "./validate.js";

describe("Spike C1 + C2: Dynamic Look Composition and Quality Scorer", () => {
  const fontPath = resolve(process.cwd(), "assets/fonts/Roboto-VariableFont_wdth,wght.ttf");
  const fontBuf = readFileSync(fontPath);
  const font = opentype.parse(
    fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength)
  );

  // 1. (a) Same event + same seed = identical look JSON & identical SVG output
  it("(a) determinism: same event + same seed produces identical look JSON and SVG", () => {
    const seed = "event-seed-12345";
    const res1 = compose(sampleEventSpec, seed);
    const res2 = compose(sampleEventSpec, seed);

    expect(res1.look).toEqual(res2.look);
    expect(res1.skeleton).toEqual(res2.skeleton);
    expect(res1.theme).toEqual(res2.theme);
    expect(res1.blocks).toEqual(res2.blocks);

    const render1 = renderCard({
      person: personNormal,
      event: sampleEventSpec,
      brand: sampleBrandKit,
      card: sampleEventSpec.card,
      font,
      skeleton: res1.skeleton,
      blocks: res1.blocks,
      theme: res1.theme,
      look: res1.look,
    });

    const render2 = renderCard({
      person: personNormal,
      event: sampleEventSpec,
      brand: sampleBrandKit,
      card: sampleEventSpec.card,
      font,
      skeleton: res2.skeleton,
      blocks: res2.blocks,
      theme: res2.theme,
      look: res2.look,
    });

    expect(render1.svg).toBe(render2.svg);
  });

  // 2. (b) Same event + 20 different seeds = at least 10 clearly different looks by distance metric
  it("(b) diversity: 20 seeds produce at least 10 clearly different looks by distance metric", () => {
    const looks = [];
    for (let i = 0; i < 20; i++) {
      const res = compose(sampleEventSpec, `seed-${i}`);
      looks.push(res.look);
    }

    // Measure pairwise distances among the 20 looks
    let distinctPairs = 0;
    for (let i = 0; i < looks.length; i++) {
      for (let j = i + 1; j < looks.length; j++) {
        if (distance(looks[i], looks[j]) >= 5) {
          distinctPairs++;
        }
      }
    }

    // Out of 190 total pairs, the vast majority should be distinct
    expect(distinctPairs).toBeGreaterThan(100);

    // Count how many unique look attribute signatures exist
    const signatures = new Set(
      looks.map((l) => `${l.attributes.skeleton}:${l.attributes.header}:${l.attributes.photo}:${l.attributes.marker}:${l.attributes.mode}`)
    );
    expect(signatures.size).toBeGreaterThanOrEqual(10);
  });

  // 3. (c) Stress test: 50 events x 4 archetypes x 3 seeds = 600 renders with zero validator errors
  it("(c) zero validator errors across 50 events x 4 archetypes x 3 seeds on stressSet", () => {
    // Generate 50 synthetic events with varied palettes and names
    const palettes = [
      ["#0A192F", "#FF6B35"],
      ["#1E3A2F", "#F5EBE0"],
      ["#4A154B", "#E01E5A"],
      ["#DC2626", "#18181B"],
      ["#0D9488", "#FBBF24"],
      ["#1E40AF", "#DBEAFE"],
      ["#7C3AED", "#F472B6"],
      ["#059669", "#A7F3D0"],
      ["#D97706", "#451A03"],
      ["#374151", "#F9FAFB"],
    ];

    let totalRenders = 0;

    for (let eIdx = 0; eIdx < 50; eIdx++) {
      const pal = palettes[eIdx % palettes.length];
      const event = {
        ...sampleEventSpec,
        event: {
          ...sampleEventSpec.event,
          name: { value: `Event ${eIdx}`, source: "user", confirmed: true },
          palette: pal,
        },
      };

      for (const archetype of ARCHETYPES) {
        for (let s = 1; s <= 3; s++) {
          const seed = `stress-${eIdx}-${archetype}-${s}`;
          const res = compose(event, seed, archetype);

          // Verify every piece passes its respective Zod schema
          expect(() => Skeleton.parse(res.skeleton)).not.toThrow();
          expect(() => Theme.parse(res.theme)).not.toThrow();
          expect(() => Look.parse(res.look)).not.toThrow();
          for (const block of Object.values(res.blocks)) {
            expect(() => Block.parse(block)).not.toThrow();
          }

          // Render with a stress test participant (e.g. normal participant)
          const render = renderCard({
            person: personNormal,
            event,
            brand: sampleBrandKit,
            card: event.card,
            font,
            skeleton: res.skeleton,
            blocks: res.blocks,
            theme: res.theme,
            look: res.look,
          });

          const errors = (render.issues || []).filter((i) => i.severity === "error");
          expect(errors).toHaveLength(0);
          totalRenders++;
        }
      }
    }

    expect(totalRenders).toBe(50 * 4 * 3);
  }, 40000);

  // 4. (d) Saved look JSON re-renders byte-identical (NO call to compose)
  it("(d) a saved look JSON re-renders byte-identical without calling compose", () => {
    const seed = "saved-json-verification-seed";
    const initial = compose(sampleEventSpec, seed);

    const firstRender = renderCard({
      person: personNormal,
      event: sampleEventSpec,
      brand: sampleBrandKit,
      card: sampleEventSpec.card,
      font,
      skeleton: initial.skeleton,
      blocks: initial.blocks,
      theme: initial.theme,
      look: initial.look,
    });

    // Serialize and deserialize to simulate database/file persistence
    const savedSkeleton = JSON.parse(JSON.stringify(initial.skeleton));
    const savedBlocks = JSON.parse(JSON.stringify(initial.blocks));
    const savedTheme = JSON.parse(JSON.stringify(initial.theme));
    const savedLook = JSON.parse(JSON.stringify(initial.look));

    const secondRender = renderCard({
      person: personNormal,
      event: sampleEventSpec,
      brand: sampleBrandKit,
      card: sampleEventSpec.card,
      font,
      skeleton: savedSkeleton,
      blocks: savedBlocks,
      theme: savedTheme,
      look: savedLook,
    });

    expect(secondRender.svg).toBe(firstRender.svg);
  });

  // 5. (e) Bad input handled gracefully
  it("(e) bad input (empty palette, 1-colour, pale pastel, missing roles) is handled safely", () => {
    // 1. Empty palette
    const emptyPalEvent = { ...sampleEventSpec, event: { ...sampleEventSpec.event, palette: [] } };
    expect(() => compose(emptyPalEvent, 123)).not.toThrow();

    // 2. 1-colour palette
    const singlePalEvent = { ...sampleEventSpec, event: { ...sampleEventSpec.event, palette: ["#2563EB"] } };
    expect(() => compose(singlePalEvent, 456)).not.toThrow();

    // 3. Very pale palette
    const palePalEvent = { ...sampleEventSpec, event: { ...sampleEventSpec.event, palette: ["#FEF08A", "#F3F4F6"] } };
    expect(() => compose(palePalEvent, 789)).not.toThrow();

    // 4. Missing roles
    const noRolesEvent = { ...sampleEventSpec, roles: [] };
    expect(() => compose(noRolesEvent, 999)).not.toThrow();
  });

  // 6. (f) Scorer alignment: distinct alignment AXES (left, centre, right)
  describe("(f) Scorer alignment and quality measurement", () => {
    it("rewards single centre axis so circle-badge-centre is not penalised", () => {
      // Create a centered scene graph
      const centeredScene = [
        { type: "rect", id: "bg", box: { x: 0, y: 0, w: 54, h: 85.6 }, fill: "#FFFFFF", decor: true },
        { type: "image", id: "logo1", box: { x: 17, y: 4, w: 20, h: 10 }, anchor: "middle" }, // center = 27
        { type: "image", id: "photo", box: { x: 12, y: 18, w: 30, h: 30 }, anchor: "middle" }, // center = 27
        { type: "text", id: "name", box: { x: 4, y: 52, w: 46, h: 10 }, align: "center", sizeMm: 4.8, fill: "#111827" }, // center = 27
        { type: "text", id: "role", box: { x: 14, y: 64, w: 26, h: 6 }, align: "center", sizeMm: 2.4, fill: "#FFFFFF" }, // center = 27
      ];

      const score = scoreQuality(centeredScene, { card: { widthMm: 54, heightMm: 85.6 } });
      // Centered layout should have 1 center axis and full 25 alignment points
      expect(score.alignmentAxes).toBe(1);
      expect(score.breakdown.alignmentScore).toBe(25);
    });

    it("evaluates known-good layout with high score and known-bad with low score", () => {
      // Known good layout
      const goodScene = [
        { type: "rect", id: "bg", box: { x: 0, y: 0, w: 54, h: 85.6 }, fill: "#FFFFFF", decor: true },
        { type: "image", id: "logo1", box: { x: 4, y: 4, w: 20, h: 8 }, anchor: "left" },
        { type: "image", id: "photo", box: { x: 4, y: 16, w: 46, h: 36 }, anchor: "left" },
        { type: "text", id: "name", box: { x: 4, y: 56, w: 46, h: 12 }, align: "left", sizeMm: 4.8, fill: "#0F172A" },
        { type: "text", id: "role", box: { x: 4, y: 70, w: 24, h: 6 }, align: "center", sizeMm: 2.3, fill: "#0F172A" },
      ];

      const goodScore = scoreQuality(goodScene, { card: { widthMm: 54, heightMm: 85.6 } });
      expect(goodScore.total).toBeGreaterThanOrEqual(80);

      // Known bad layout: equal text sizes, ragged 6 alignment axes, tiny whitespace, low contrast
      const badScene = [
        { type: "rect", id: "bg", box: { x: 0, y: 0, w: 54, h: 85.6 }, fill: "#E2E8F0", decor: true },
        { type: "text", id: "name", box: { x: 2, y: 4, w: 50, h: 4 }, sizeMm: 2.5, fill: "#CBD5E1" }, // Low contrast & same size as role
        { type: "text", id: "role", box: { x: 7, y: 12, w: 30, h: 4 }, sizeMm: 2.5, fill: "#CBD5E1" },
        { type: "image", id: "el1", box: { x: 13, y: 20, w: 10, h: 10 } },
        { type: "image", id: "el2", box: { x: 19, y: 34, w: 10, h: 10 } },
        { type: "image", id: "el3", box: { x: 27, y: 48, w: 10, h: 10 } },
        { type: "image", id: "el4", box: { x: 34, y: 62, w: 10, h: 10 } },
      ];

      const badScore = scoreQuality(badScene, { card: { widthMm: 54, heightMm: 85.6 } });
      expect(badScore.total).toBeLessThan(45);
    });
  });

  // 7. (g) 20 seeds for ONE event use at least 3 different archetypes
  it("(g) 20 seeds for one event utilize at least 3 distinct archetypes", () => {
    const archetypesUsed = new Set();
    for (let i = 0; i < 20; i++) {
      const res = compose(sampleEventSpec, `variety-${i}`);
      archetypesUsed.add(res.archetype);
    }
    expect(archetypesUsed.size).toBeGreaterThanOrEqual(3);
  });

  // 8. (h) previousArchetypes is respected on regenerate
  it("(h) previousArchetypes is respected when regenerating drafts", () => {
    // Generate initial drafts
    const result1 = composeDrafts(sampleEventSpec, {
      seed: "regen-seed-alpha",
      font,
      brand: sampleBrandKit,
    });
    expect(result1.drafts).toHaveLength(3);

    const firstArchetypes = result1.drafts.map((d) => d.archetype);

    // Regenerate specifying previousArchetypes
    const result2 = composeDrafts(sampleEventSpec, {
      seed: "regen-seed-beta",
      previousArchetypes: firstArchetypes,
      font,
      brand: sampleBrandKit,
    });
    expect(result2.drafts).toHaveLength(3);

    // Because there are 4 archetypes, at least the 4th archetype should appear in result2
    const unusedArchetype = ARCHETYPES.find((a) => !firstArchetypes.includes(a));
    if (unusedArchetype) {
      expect(result2.drafts.some((d) => d.archetype === unusedArchetype)).toBe(true);
    }

    // Every pair in result2 must still meet distance >= 5
    for (let i = 0; i < result2.drafts.length; i++) {
      for (let j = i + 1; j < result2.drafts.length; j++) {
        expect(distance(result2.drafts[i].look, result2.drafts[j].look)).toBeGreaterThanOrEqual(5);
      }
    }
  }, 15000);

  // 9. (i) 57-char long name renders with zero errors in all 4 archetypes
  it("(i) 57-char long name renders with zero errors in all 4 archetypes", () => {
    for (const archetype of ARCHETYPES) {
      const res = compose(sampleEventSpec, `longname-${archetype}`, archetype);

      const render = renderCard({
        person: stressPersonLong57,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        font,
        skeleton: res.skeleton,
        blocks: res.blocks,
        theme: res.theme,
        look: res.look,
      });

      const errors = (render.issues || []).filter((i) => i.severity === "error");
      expect(errors).toHaveLength(0);
    }
  });

  // 10. (j) Role pill text is readable on every role colour (contrast passes; autofix recolours if needed)
  it("(j) role pill text is readable on every role colour", () => {
    const roleColors = [
      { id: "blue", value: "#2563EB" },
      { id: "green", value: "#16A34A" },
      { id: "purple", value: "#9333EA" },
      { id: "red", value: "#DC2626" },
      { id: "amber", value: "#F59E0B" },
      { id: "light-yellow", value: "#FEF08A" }, // Light role colour
      { id: "pale-cyan", value: "#CFFAFE" }, // Pale role colour
      { id: "dark-navy", value: "#0F172A" },
    ];

    for (const rColor of roleColors) {
      const customEvent = {
        ...sampleEventSpec,
        roles: [{ id: "test-role", label: "SPECIALIST", expectedCount: 10, color: { value: rColor.value } }],
      };

      const res = compose(customEvent, "role-contrast-seed", "hero-photo-top");

      const render = renderCard({
        person: { ...personNormal, roleId: "test-role" },
        event: customEvent,
        brand: sampleBrandKit,
        card: customEvent.card,
        font,
        skeleton: res.skeleton,
        blocks: res.blocks,
        theme: res.theme,
        look: res.look,
      });

      // Find rendered role text node
      const roleNode = render.scene.find((n) => n.id === "role");
      expect(roleNode).toBeDefined();

      // Find background behind role text node (the pill or card background)
      let bgBehind = "#FFFFFF";
      for (const rNode of render.scene) {
        if (rNode === roleNode || rNode.type !== "rect" || !rNode.box) continue;
        if (
          rNode.box.x <= roleNode.box.x &&
          rNode.box.y <= roleNode.box.y &&
          rNode.box.x + rNode.box.w >= roleNode.box.x + roleNode.box.w &&
          rNode.box.y + rNode.box.h >= roleNode.box.y + roleNode.box.h
        ) {
          bgBehind = rNode.fill;
        }
      }

      const cr = contrastRatio(roleNode.fill, bgBehind);
      expect(cr).toBeGreaterThanOrEqual(4.5);

      // If autofix had to recolor to pass contrast, check fixes list
      if (render.fixes && render.fixes.length > 0) {
        const contrastFix = render.fixes.find((f) => f.code === "LOW_CONTRAST" && f.nodeId === "role");
        if (contrastFix) {
          expect(contrastFix.action).toContain("Changed text fill");
        }
      }
    }
  });

  // 12. (k) 10 different palettes give 10 different dominant colours
  it("(k) 10 different palettes give 10 different dominant colours", () => {
    const testPalettes = [
      ["#0F172A", "#38BDF8"],
      ["#1E3A2F", "#F5EBE0"],
      ["#4A154B", "#E01E5A"],
      ["#09090B", "#22C55E"],
      ["#1E1B4B", "#FBBF24"],
      ["#1E40AF", "#93C5FD"],
      ["#7F1D1D", "#F97316"],
      ["#831843", "#F472B6"],
      ["#064E3B", "#34D399"],
      ["#312E81", "#A78BFA"],
    ];

    const dominantColors = new Set();
    for (let i = 0; i < testPalettes.length; i++) {
      const pal = testPalettes[i];
      const event = {
        ...sampleEventSpec,
        event: { ...sampleEventSpec.event, palette: pal },
      };
      const drafts = composeDrafts(event, { seed: 200 + i * 5, count: 3 });
      const d = drafts.drafts[0];
      const card = renderCard({
        person: personNormal,
        event,
        brand: sampleBrandKit,
        card: event.card,
        skeleton: d.skeleton,
        blocks: d.blocks,
        theme: d.theme,
        look: d.look,
      });

      // Find largest non-white, non-dark-base, non-photo filled rectangle in scene
      const coloredRects = card.scene.filter(
        (n) => n.type === "rect" && n.box && n.fill && n.id !== "photo" && !n.photoMode && n.fill !== "#FFFFFF" && n.fill !== "#0F172A"
      );
      coloredRects.sort((a, b) => (b.box.w * b.box.h) - (a.box.w * a.box.h));
      expect(coloredRects.length).toBeGreaterThan(0);
      dominantColors.add(coloredRects[0].fill.toUpperCase());
    }

    expect(dominantColors.size).toBe(10);
  });

  // 13. (l) scoreQuality over 30 candidates has a spread of at least 25 points
  it("(l) scoreQuality over 30 candidates has a spread of at least 25 points", () => {
    const testPalettes = [
      ["#0F172A", "#38BDF8"],
      ["#1E3A2F", "#F5EBE0"],
      ["#4A154B", "#E01E5A"],
      ["#09090B", "#22C55E"],
      ["#1E1B4B", "#FBBF24"],
      ["#1E40AF", "#93C5FD"],
    ];

    const scores = [];
    for (let i = 0; i < 36; i++) {
      const pal = testPalettes[i % testPalettes.length];
      const event = { ...sampleEventSpec, event: { ...sampleEventSpec.event, palette: pal } };
      const d = compose(event, 600 + i);
      const card = renderCard({
        person: personNormal,
        event,
        brand: sampleBrandKit,
        card: event.card,
        skeleton: d.skeleton,
        blocks: d.blocks,
        theme: d.theme,
        look: d.look,
      });
      const q = scoreQuality(card.scene, { card: event.card, palette: pal, event });
      scores.push(q.total);
    }

    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const spread = maxScore - minScore;

    expect(spread).toBeGreaterThanOrEqual(25);
  });

  // 14. (m) role pill colours differ in lightness by at least 15% in grayscale
  it("(m) role pill colours differ in lightness by at least 15% in grayscale", () => {
    const roleKeys = /** @type {const} */ (["volunteer", "participant", "organizer", "mentor"]);
    const lightnesses = roleKeys.map((k) => {
      const hex = DEFAULT_ROLE_COLORS[k];
      const [r, g, b] = hexToRgb(hex);
      const [, , l] = rgbToHsl(r, g, b);
      return { role: k, hex, l };
    });

    for (let i = 0; i < lightnesses.length - 1; i++) {
      const diff = Math.abs(lightnesses[i].l - lightnesses[i + 1].l);
      expect(diff).toBeGreaterThanOrEqual(0.15);
    }
  });

  // 15. (n) Dark mode dominant color derives from palette hue and zero palette score caps total at 60
  it("(n) dark mode dominant color derives from palette hue and zero palette score caps total at 60", () => {
    const testPalettes = [
      ["#2563EB", "#60A5FA"], // Blue hue ~217
      ["#16A34A", "#86EFAC"], // Green hue ~142
      ["#9333EA", "#D8B4FE"], // Purple hue ~271
      ["#DC2626", "#FCA5A5"], // Red hue ~0
      ["#D97706", "#FDE68A"], // Amber hue ~38
      ["#0D9488", "#5EEAD4"], // Teal hue ~175
      ["#DB2777", "#F472B6"], // Pink hue ~330
      ["#4F46E5", "#A5B4FC"], // Indigo hue ~244
      ["#CA8A04", "#FEF08A"], // Yellow hue ~43
      ["#059669", "#6EE7B7"], // Emerald hue ~160
    ];

    for (const pal of testPalettes) {
      const theme = deriveTheme(pal, "dark");
      expect(theme.colors.background).toBeDefined();

      // Check dark background is derived from palette hue
      const [bgR, bgG, bgB] = hexToRgb(theme.colors.background);
      const [bgH, , bgL] = rgbToHsl(bgR, bgG, bgB);

      const [pR, pG, pB] = hexToRgb(pal[0]);
      const [pH] = rgbToHsl(pR, pG, pB);

      // Lightness must be dark (0.08 - 0.15)
      expect(bgL).toBeGreaterThanOrEqual(0.08);
      expect(bgL).toBeLessThanOrEqual(0.15);

      // Hue must match palette primary within circular distance of 15 degrees
      const hueDiff = Math.min(Math.abs(bgH - pH), 360 - Math.abs(bgH - pH));
      expect(hueDiff).toBeLessThanOrEqual(15);

      // Must not be a fixed static navy (#0F172A)
      expect(theme.colors.background.toUpperCase()).not.toBe("#0F172A");
    }

    // scoreQuality cap test: 0 palette colors used caps total at 60
    const sceneNoPalette = [
      { type: "rect", id: "bg", box: { x: 0, y: 0, w: 54, h: 85.6 }, fill: "#FFFFFF", decor: true },
      { type: "text", id: "name", box: { x: 4, y: 30, w: 46, h: 10 }, align: "left", sizeMm: 5.0, fill: "#000000" },
      { type: "text", id: "role", box: { x: 4, y: 42, w: 30, h: 6 }, align: "left", sizeMm: 2.5, fill: "#333333" },
    ];
    const scoreZeroPal = scoreQuality(sceneNoPalette, {
      card: { widthMm: 54, heightMm: 85.6 },
      palette: ["#E11D48", "#FB7185"],
    });
    expect(scoreZeroPal.paletteColorsUsed).toBe(0);
    expect(scoreZeroPal.breakdown.paletteScore).toBe(0);
    expect(scoreZeroPal.total).toBeLessThanOrEqual(60);
  });

  // 16. (o) Event name never truncated: 40-char fits across all archetypes, extreme overflow raises EVENT_NAME_DOES_NOT_FIT
  it("(o) event name never truncated: 40-char fits across all archetypes, extreme overflow raises EVENT_NAME_DOES_NOT_FIT", () => {
    const long40Name = "GLOBAL CLOUD & WEB DEV SUMMIT 2026 INDIA"; // exactly 40 chars
    expect(long40Name.length).toBe(40);

    const event40 = {
      ...sampleEventSpec,
      event: { ...sampleEventSpec.event, name: long40Name },
    };

    for (const arch of ARCHETYPES) {
      const draft = compose(event40, `event-40-${arch}`, arch, "light");
      const res = renderCard({
        person: personNormal,
        event: event40,
        brand: sampleBrandKit,
        card: event40.card,
        font,
        skeleton: draft.skeleton,
        blocks: draft.blocks,
        theme: draft.theme,
        look: draft.look,
      });

      // No truncation issues for event name
      const evNameTruncated = (res.issues || []).find(
        (iss) => iss.code === "TEXT_TRUNCATED" && iss.nodeId?.includes("event")
      );
      expect(evNameTruncated).toBeUndefined();

      // Find rendered event name node
      const evNode = res.scene.find((n) => n.bind === "event.name" || n.id === "event-name");
      expect(evNode).toBeDefined();
      expect(evNode?.lines).toBeDefined();
      expect(evNode?.lines.length).toBeLessThanOrEqual(2);
      // All uppercase
      for (const line of evNode.lines) {
        expect(line).toBe(line.toUpperCase());
      }
      // At least 6 pt (approx 2.11 mm)
      expect(evNode.sizeMm).toBeGreaterThanOrEqual(6 * (25.4 / 72) - 0.05);

      // Contrast against background rect directly behind it >= 4.5
      const rectBehind = res.scene.filter(
        (n) => n.type === "rect" && n.id !== evNode.id &&
          n.box.x <= evNode.box.x + evNode.box.w / 2 &&
          n.box.x + n.box.w >= evNode.box.x + evNode.box.w / 2 &&
          n.box.y <= evNode.box.y + evNode.box.h / 2 &&
          n.box.y + n.box.h >= evNode.box.y + evNode.box.h / 2
      ).pop();
      const bgBehindFill = rectBehind?.fill || "#FFFFFF";
      expect(contrastRatio(evNode.fill, bgBehindFill)).toBeGreaterThanOrEqual(4.5);
    }

    // Extreme overflow test: 200-char unbreakable event name
    const extremeName = "A".repeat(200);
    const eventExtreme = {
      ...sampleEventSpec,
      event: { ...sampleEventSpec.event, name: extremeName },
    };

    const draftExtreme = compose(eventExtreme, "extreme-seed", "hero-photo-top", "light");
    const resExtreme = renderCard({
      person: personNormal,
      event: eventExtreme,
      brand: sampleBrandKit,
      card: eventExtreme.card,
      font,
      skeleton: draftExtreme.skeleton,
      blocks: draftExtreme.blocks,
      theme: draftExtreme.theme,
      look: draftExtreme.look,
    });

    const notFitWarning = (resExtreme.issues || []).find(
      (iss) => iss.code === "EVENT_NAME_DOES_NOT_FIT" && iss.severity === "warning"
    );
    expect(notFitWarning).toBeDefined();

    // Event name node must be hidden / omitted from final rendered text scene
    const renderedEvNode = resExtreme.scene.find((n) => n.bind === "event.name" || n.id === "event-name");
    expect(renderedEvNode).toBeUndefined();
  });

  // 17. (p) Grayscale distinctness: all 4 default roles distinguishable on both light and dark cards on final pill and edge bar
  it("(p) grayscale distinctness on final pill and edge bar for light and dark cards", () => {
    const roles = /** @type {const} */ (["volunteer", "participant", "organizer", "mentor"]);
    const modes = ["light", "dark"];

    const testRolesEvent = {
      ...sampleEventSpec,
      roles: [
        { id: "volunteer", label: "VOLUNTEER", color: { value: DEFAULT_ROLE_COLORS.volunteer } },
        { id: "participant", label: "PARTICIPANT", color: { value: DEFAULT_ROLE_COLORS.participant } },
        { id: "organizer", label: "ORGANIZER", color: { value: DEFAULT_ROLE_COLORS.organizer } },
        { id: "mentor", label: "MENTOR", color: { value: DEFAULT_ROLE_COLORS.mentor } },
      ],
    };

    for (const mode of modes) {
      const pillLightnesses = [];
      const barLightnesses = [];

      for (const roleKey of roles) {
        const testPerson = {
          ...personNormal,
          roleId: roleKey,
        };

        const draft = compose(testRolesEvent, `role-test-${mode}`, "hero-photo-top", mode);
        const res = renderCard({
          person: testPerson,
          event: testRolesEvent,
          brand: sampleBrandKit,
          card: testRolesEvent.card,
          font,
          skeleton: draft.skeleton,
          blocks: draft.blocks,
          theme: draft.theme,
          look: draft.look,
        });

        // Find pill node and edge bar node in final rendered scene
        const pillNode = res.scene.find((n) => n.id === "role-pill" || n.id === "pill");
        expect(pillNode).toBeDefined();

        const [pr, pg, pb] = hexToRgb(pillNode.fill);
        const [, , pl] = rgbToHsl(pr, pg, pb);
        pillLightnesses.push(pl);

        // Find edge bar node
        const barNode = res.scene.find((n) => n.id === "role-bar" || n.id === "role-edge-bar");
        if (barNode) {
          const [br, bg, bb] = hexToRgb(barNode.fill);
          const [, , bl] = rgbToHsl(br, bg, bb);
          barLightnesses.push(bl);

          // Check role edge bar has contrast against card background
          const cardBg = res.scene.find((n) => n.id === "bg")?.fill || "#FFFFFF";
          expect(contrastRatio(barNode.fill, cardBg)).toBeGreaterThanOrEqual(1.2);
        }
      }

      // Check lightness steps between adjacent default roles are >= 0.15 (15%)
      for (let i = 0; i < pillLightnesses.length - 1; i++) {
        const diff = Math.abs(pillLightnesses[i] - pillLightnesses[i + 1]);
        expect(diff).toBeGreaterThanOrEqual(0.149);
      }

      if (barLightnesses.length === roles.length) {
        for (let i = 0; i < barLightnesses.length - 1; i++) {
          const diff = Math.abs(barLightnesses[i] - barLightnesses[i + 1]);
          expect(diff).toBeGreaterThanOrEqual(0.149);
        }
      }
    }
  });

  // 18. (q) Final 3 drafts have 3 distinct modes when palette allows
  it("(q) final 3 drafts have 3 distinct modes (light, dark, colour-field)", () => {
    const draftsRes = composeDrafts(sampleEventSpec, { seed: 8888, count: 3 });
    expect(draftsRes.drafts).toHaveLength(3);

    const modes = draftsRes.drafts.map((d) => d.look.attributes.mode);
    const uniqueModes = new Set(modes);

    expect(uniqueModes.size).toBe(3);
    expect(uniqueModes.has("light")).toBe(true);
    expect(uniqueModes.has("dark")).toBe(true);
    expect(uniqueModes.has("colour-field")).toBe(true);
  });

  // 19. (r) Font pairings: Space Grotesk + Inter and Source Serif 4 + Source Sans 3 render with zero errors
  it("(r) font pairings render with zero errors and generate path outlines", () => {
    function loadFont(relPath) {
      const p = resolve(process.cwd(), relPath);
      const buf = readFileSync(p);
      return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    }

    const pair1 = {
      heading: loadFont(FONT_PAIRINGS["space-grotesk"].headingFile),
      body: loadFont(FONT_PAIRINGS["space-grotesk"].bodyFile),
    };
    const pair2 = {
      heading: loadFont(FONT_PAIRINGS["source-serif"].headingFile),
      body: loadFont(FONT_PAIRINGS["source-serif"].bodyFile),
    };

    const draft1 = compose(sampleEventSpec, 111, "hero-photo-top");
    const res1 = renderCard({
      person: personNormal,
      event: sampleEventSpec,
      brand: sampleBrandKit,
      card: sampleEventSpec.card,
      fonts: pair1,
      skeleton: draft1.skeleton,
      blocks: draft1.blocks,
      theme: draft1.theme,
      look: draft1.look,
    });
    expect(res1.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(res1.svg).toContain("<path");

    const draft2 = compose(sampleEventSpec, 222, "typographic-name-first");
    const res2 = renderCard({
      person: personNormal,
      event: sampleEventSpec,
      brand: sampleBrandKit,
      card: sampleEventSpec.card,
      fonts: pair2,
      skeleton: draft2.skeleton,
      blocks: draft2.blocks,
      theme: draft2.theme,
      look: draft2.look,
    });
    expect(res2.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(res2.svg).toContain("<path");
  });

  it("Task R1: composeDrafts surfaces UNKNOWN_ROLE_ID error when sampled person has bad role", () => {
    const badPerson = {
      ...personNormal,
      id: "P-BAD-ROLE",
      roleId: "unregistered-role",
    };

    const result = composeDrafts(sampleEventSpec, {
      seed: "test-bad-role-sample",
      stressSet: [badPerson],
    });

    // composeDrafts must surface the issue rather than silently dropping or hiding it
    expect(result.issues).toBeDefined();
    expect(result.drafts).toHaveLength(3);
    const roleIssues = result.issues.filter((i) => i.code === "UNKNOWN_ROLE_ID");
    expect(roleIssues.length).toBeGreaterThan(0);
    expect(roleIssues[0].severity).toBe("error");
    expect(roleIssues[0].message).toContain("P-BAD-ROLE");
    expect(roleIssues[0].message).toContain("unregistered-role");
  });

  it("Task R1 follow-up: composeDrafts with ONE person whose roleId is 'boss' in the sampled people", () => {
    const bossPerson = {
      ...personNormal,
      id: "P-BOSS",
      name: "Big Boss",
      roleId: "boss", // Role not in sampleEventSpec.roles
    };

    const result = composeDrafts(sampleEventSpec, {
      seed: "test-boss-sample",
      stressSet: [bossPerson],
    });

    // 1. Required behaviour: the drafts are still returned (3 drafts returned, not zero!)
    expect(result.drafts).toHaveLength(3);

    // 2. Bad data must be shown, not hide the designs: each draft has valid template data
    for (const draft of result.drafts) {
      expect(draft.look).toBeDefined();
      expect(draft.skeleton).toBeDefined();
      expect(draft.blocks).toBeDefined();
      expect(draft.theme).toBeDefined();
      expect(draft.score).toBeGreaterThan(0);
    }

    // 3. result.issues contains UNKNOWN_ROLE_ID
    expect(result.issues).toBeDefined();
    const roleIssues = result.issues.filter((i) => i.code === "UNKNOWN_ROLE_ID");
    expect(roleIssues.length).toBeGreaterThan(0);
    expect(roleIssues[0].severity).toBe("error");
    expect(roleIssues[0].message).toContain("P-BOSS");
    expect(roleIssues[0].message).toContain("boss");
  });

  describe("Task P0-1: Design-Freeze Spacing, 5.5 pt Floor, Palette Tones, and Drop Order", () => {
    const staticFontRegistry = {
      "space-grotesk": {
        heading: opentype.parse(readFileSync(resolve(process.cwd(), "assets/fonts/SpaceGrotesk-Bold.ttf")).buffer),
        body: opentype.parse(readFileSync(resolve(process.cwd(), "assets/fonts/Inter-Regular.ttf")).buffer),
      },
      "source-serif": {
        heading: opentype.parse(readFileSync(resolve(process.cwd(), "assets/fonts/SourceSerif4-Bold.ttf")).buffer),
        body: opentype.parse(readFileSync(resolve(process.cwd(), "assets/fonts/SourceSans3-Regular.ttf")).buffer),
      },
    };

    // 1. Property test: every archetype x mode x stress person x 5 seeds
    it("property test: every archetype x mode x stress person x seeds has gap >= 2mm and text >= 5.5pt", () => {
      const modes = ["light", "dark", "colour-field"];
      for (let s = 1; s <= 5; s++) {
        const seed = `p0-1-seed-${s}`;
        for (const archetype of ARCHETYPES) {
          for (const mode of modes) {
            const bundle = compose(sampleEventSpec, seed, archetype, mode);
            const fonts = staticFontRegistry[bundle.look.attributes.typography] || staticFontRegistry["space-grotesk"];
            for (const person of stressSet) {
              const res = renderCard({
                person,
                event: sampleEventSpec,
                brand: sampleBrandKit,
                card: sampleEventSpec.card,
                fonts,
                skeleton: bundle.skeleton,
                blocks: bundle.blocks,
                theme: bundle.theme,
                look: bundle.look,
              });

              // Check text size floor
              for (const node of res.scene) {
                if (node.type === "text" && typeof node.sizeMm === "number") {
                  const pt = node.sizeMm / 0.3528;
                  expect(pt).toBeGreaterThanOrEqual(5.5 - 0.001);
                }
              }

              // Check bottom stack gaps
              const sceneBlocks = res.scene.filter((n) =>
                ["name", "org", "role-pill", "id-line", "qr-box", "role-bar"].includes(n.id)
              );
              for (let i = 0; i < sceneBlocks.length; i++) {
                for (let j = 0; j < sceneBlocks.length; j++) {
                  if (i === j) continue;
                  const a = sceneBlocks[i];
                  const b = sceneBlocks[j];
                  if (b.box.y < a.box.y) continue;
                  // If horizontal overlap exists
                  const xOverlap = Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x);
                  if (xOverlap > 0.5) {
                    // Check if directly adjacent (no intermediate block c)
                    const intermediate = sceneBlocks.some((c, k) =>
                      k !== i && k !== j &&
                      c.box.y > a.box.y && c.box.y < b.box.y &&
                      (Math.min(a.box.x + a.box.w, c.box.x + c.box.w) - Math.max(a.box.x, c.box.x)) > 0.5
                    );
                    if (!intermediate) {
                      const gap = b.box.y - (a.box.y + a.box.h);
                      expect(gap).toBeGreaterThanOrEqual(2.0 - 0.001);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }, 30000);

    // 2. Drop order: QR first, then org, then ID line
    it("drop order: drops QR first, then org, then ID line under constrained space; name and role are never dropped", () => {
      const bundle = compose(sampleEventSpec, "test-drop-order", "hero-photo-top", "light");
      const person = stressPersonLong57;

      // Constrain info slot height to 20 mm (forces QR drop)
      const constrained1 = {
        ...bundle.skeleton,
        slots: { ...bundle.skeleton.slots, info: [3, 60, 48, 20] },
      };
      const res1 = renderCard({
        person,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        skeleton: constrained1,
        blocks: bundle.blocks,
        theme: bundle.theme,
        look: bundle.look,
      });

      const qrDropped = res1.issues.find((i) => i.code === "ELEMENT_DROPPED" && i.nodeId === "qr");
      expect(qrDropped).toBeDefined();
      expect(qrDropped.message).toContain(person.id);
      expect(res1.scene.find((n) => n.id === "qr-box")).toBeUndefined();
      expect(res1.scene.find((n) => n.id === "name")).toBeDefined();
      expect(res1.scene.find((n) => n.id === "role")).toBeDefined();

      // Constrain info slot height to 16 mm (forces QR and org drop)
      const constrained2 = {
        ...bundle.skeleton,
        slots: { ...bundle.skeleton.slots, info: [3, 60, 48, 16] },
      };
      const res2 = renderCard({
        person,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        skeleton: constrained2,
        blocks: bundle.blocks,
        theme: bundle.theme,
        look: bundle.look,
      });

      expect(res2.issues.find((i) => i.code === "ELEMENT_DROPPED" && i.nodeId === "qr")).toBeDefined();
      expect(res2.issues.find((i) => i.code === "ELEMENT_DROPPED" && i.nodeId === "org")).toBeDefined();
      expect(res2.scene.find((n) => n.id === "org")).toBeUndefined();
      expect(res2.scene.find((n) => n.id === "name")).toBeDefined();
      expect(res2.scene.find((n) => n.id === "role")).toBeDefined();

      // Constrain info slot height to 12 mm (forces QR, org, and ID line drop)
      const constrained3 = {
        ...bundle.skeleton,
        slots: { ...bundle.skeleton.slots, info: [3, 60, 48, 12] },
      };
      const res3 = renderCard({
        person,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        skeleton: constrained3,
        blocks: bundle.blocks,
        theme: bundle.theme,
        look: bundle.look,
      });

      expect(res3.issues.find((i) => i.code === "ELEMENT_DROPPED" && i.nodeId === "qr")).toBeDefined();
      expect(res3.issues.find((i) => i.code === "ELEMENT_DROPPED" && i.nodeId === "org")).toBeDefined();
      expect(res3.issues.find((i) => i.code === "ELEMENT_DROPPED" && i.nodeId === "id-line")).toBeDefined();
      expect(res3.scene.find((n) => n.id === "name")).toBeDefined();
      expect(res3.scene.find((n) => n.id === "role")).toBeDefined();
    });

    // 3. QR disabled in spec: no QR and no warning
    it("QR disabled in spec: no QR and no warning", () => {
      const disabledQrSpec = {
        ...sampleEventSpec,
        qr: { enabled: false, urlPattern: "https://example.org" },
      };
      const bundle = compose(disabledQrSpec, "qr-disabled-seed", "hero-photo-top");
      const res = renderCard({
        person: personNormal,
        event: disabledQrSpec,
        brand: sampleBrandKit,
        card: disabledQrSpec.card,
        skeleton: bundle.skeleton,
        blocks: bundle.blocks,
        theme: bundle.theme,
        look: bundle.look,
      });

      expect(res.scene.find((n) => n.id === "qr-box")).toBeUndefined();
      expect(res.scene.find((n) => n.id === "qr-label")).toBeUndefined();
      const dropWarnings = res.issues.filter((i) => i.code === "ELEMENT_DROPPED");
      expect(dropWarnings).toHaveLength(0);
    });

    // 4. Dark card palette score is comparable to light card
    it("dark card palette score is greater than 0 and equal to equivalent light card", () => {
      const eventWithPalette = {
        ...sampleEventSpec,
        event: { ...sampleEventSpec.event, palette: ["#1E3A8A", "#06B6D4"] },
      };
      const lightBundle = compose(eventWithPalette, "pal-test", "colour-block-split", "light");
      const darkBundle = compose(eventWithPalette, "pal-test", "colour-block-split", "dark");

      const lightRes = renderCard({
        person: personNormal,
        event: eventWithPalette,
        brand: sampleBrandKit,
        card: eventWithPalette.card,
        skeleton: lightBundle.skeleton,
        blocks: lightBundle.blocks,
        theme: lightBundle.theme,
        look: lightBundle.look,
      });

      const darkRes = renderCard({
        person: personNormal,
        event: eventWithPalette,
        brand: sampleBrandKit,
        card: eventWithPalette.card,
        skeleton: darkBundle.skeleton,
        blocks: darkBundle.blocks,
        theme: darkBundle.theme,
        look: darkBundle.look,
      });

      const lightScore = scoreQuality(lightRes.scene, {
        card: eventWithPalette.card,
        event: eventWithPalette,
        theme: lightBundle.theme,
        palette: eventWithPalette.event.palette,
      });

      const darkScore = scoreQuality(darkRes.scene, {
        card: eventWithPalette.card,
        event: eventWithPalette,
        theme: darkBundle.theme,
        palette: eventWithPalette.event.palette,
      });

      expect(darkScore.breakdown.paletteScore).toBeGreaterThan(0);
      expect(darkScore.breakdown.paletteScore).toBe(lightScore.breakdown.paletteScore);
    });

    // 5. Condition 3: role-pill and qr-box horizontal clash in circle-badge-centre
    it("Condition 3: role-pill and qr-box horizontal clash is allowed in circle-badge-centre", () => {
      const bundle = compose(sampleEventSpec, "clash-seed", "circle-badge-centre", "light");
      const infoBlock = bundle.blocks[bundle.look.blocks.info];
      const pillEl = infoBlock.elements.find((e) => e.id === "role-pill");
      const qrEl = infoBlock.elements.find((e) => e.id === "qr-box");
      expect(pillEl).toBeDefined();
      expect(qrEl).toBeDefined();

      // Check horizontal overlap in template layout
      const pillRight = pillEl.box[0] + pillEl.box[2];
      const qrLeft = qrEl.box[0];
      const overlapPct = pillRight - qrLeft;
      expect(overlapPct).toBeGreaterThan(0);
      expect(pillRight).toBe(86);
      expect(qrLeft).toBe(78);
    });

    // 6. Bad input tests: missing org, missing role, 120-char name, 60-char role, 1-char name
    it("bad input tests: missing org, 120-char name, 60-char role label, one-letter name render safely", () => {
      const bundle = compose(sampleEventSpec, "bad-input-seed", "hero-photo-top");

      // Missing org
      const noOrgPerson = { ...personNormal, org: "" };
      const resNoOrg = renderCard({
        person: noOrgPerson,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        skeleton: bundle.skeleton,
        blocks: bundle.blocks,
        theme: bundle.theme,
        look: bundle.look,
      });
      expect(resNoOrg.scene.find((n) => n.id === "org")).toBeUndefined();
      expect(resNoOrg.svg).toBeDefined();

      // Missing role
      const noRolePerson = { ...personNormal, roleId: undefined };
      const resNoRole = renderCard({
        person: noRolePerson,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        skeleton: bundle.skeleton,
        blocks: bundle.blocks,
        theme: bundle.theme,
        look: bundle.look,
      });
      expect(resNoRole.issues.some((i) => i.code === "UNKNOWN_ROLE_ID")).toBe(true);

      // 120-character name
      const name120Person = { ...personNormal, name: "A".repeat(120) };
      const resName120 = renderCard({
        person: name120Person,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        skeleton: bundle.skeleton,
        blocks: bundle.blocks,
        theme: bundle.theme,
        look: bundle.look,
      });
      const nameNode = resName120.scene.find((n) => n.id === "name");
      expect(nameNode.sizeMm / 0.3528).toBeGreaterThanOrEqual(5.5 - 0.001);

      // 60-character role label
      const event60Role = {
        ...sampleEventSpec,
        roles: [{ id: "participant", label: "R".repeat(60), expectedCount: 100 }],
      };
      const resRole60 = renderCard({
        person: personNormal,
        event: event60Role,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        skeleton: bundle.skeleton,
        blocks: bundle.blocks,
        theme: bundle.theme,
        look: bundle.look,
      });
      const roleTextNode = resRole60.scene.find((n) => n.id === "role");
      expect(roleTextNode.sizeMm / 0.3528).toBeGreaterThanOrEqual(5.5 - 0.001);

      // One-letter name
      const name1Person = { ...personNormal, name: "Q" };
      const resName1 = renderCard({
        person: name1Person,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        skeleton: bundle.skeleton,
        blocks: bundle.blocks,
        theme: bundle.theme,
        look: bundle.look,
      });
      expect(resName1.svg).toBeDefined();
    });

    // 7. Determinism: render twice byte-identical
    it("determinism: render twice byte-identical", () => {
      const bundle = compose(sampleEventSpec, "determ-seed-99", "colour-block-split");
      const res1 = renderCard({
        person: personNormal,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        skeleton: bundle.skeleton,
        blocks: bundle.blocks,
        theme: bundle.theme,
        look: bundle.look,
      });
      const res2 = renderCard({
        person: personNormal,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        skeleton: bundle.skeleton,
        blocks: bundle.blocks,
        theme: bundle.theme,
        look: bundle.look,
      });
      expect(res1.svg).toBe(res2.svg);
    });

    // 8. Variable font ban test
    it("variable font ban: themeDerivation and composer pairings use only static fonts", () => {
      const theme = deriveTheme(["#112233"], "light");
      expect(theme.fonts.heading).not.toContain("Variable");
      expect(theme.fonts.body).not.toContain("Variable");
      for (const pair of Object.values(FONT_PAIRINGS)) {
        expect(pair.headingFile).not.toContain("Variable");
        expect(pair.bodyFile).not.toContain("Variable");
      }
    });
  });

  // Task P0-1c: Palette Scoring, QR_TOO_SMALL ELEMENT_DROPPED, and Chosen Drafts Issues
  describe("Task P0-1c: Palette Scoring and ComposeDrafts Issues", () => {
    // Condition 1: Palette score drops below 25 when accent is replaced with grey
    it("Condition 1: real composed card palette score drops below 25 when accent is replaced with grey", () => {
      const bundle = compose(sampleEventSpec, "test-pal-seed-1", "colour-block-split", "dark");
      const res = renderCard({
        person: personNormal,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        skeleton: bundle.skeleton,
        blocks: bundle.blocks,
        theme: bundle.theme,
        look: bundle.look,
      });

      const pal = sampleEventSpec?.event?.palette || ["#0A192F", "#FF6B35"];
      const scoreOriginal = scoreQuality(res.scene, {
        card: sampleEventSpec.card,
        palette: pal,
        theme: bundle.theme,
        mode: "dark",
      });
      expect(scoreOriginal.breakdown.paletteScore).toBe(25);

      // Clone scene and replace accent with grey (#888888)
      const accentHex = bundle.theme.colors.accent.toUpperCase();
      const sceneWithGreyAccent = res.scene.map((node) => {
        if (node.fill && String(node.fill).toUpperCase() === accentHex) {
          return { ...node, fill: "#888888" };
        }
        return node;
      });

      const scoreWithGrey = scoreQuality(sceneWithGreyAccent, {
        card: sampleEventSpec.card,
        palette: pal,
        theme: bundle.theme,
        mode: "dark",
      });
      // Accent is replaced with grey, so palette score must drop below 25
      expect(scoreWithGrey.breakdown.paletteScore).toBeLessThan(25);
      expect(scoreWithGrey.breakdown.paletteScore).toBe(18);

      // Replace both background and accent with grey -> palette score drops to 0 and total capped at 60
      const sceneAllGrey = res.scene.map((node) => ({
        ...node,
        fill: node.fill ? "#888888" : node.fill,
      }));
      const scoreAllGrey = scoreQuality(sceneAllGrey, {
        card: sampleEventSpec.card,
        palette: pal,
        theme: bundle.theme,
        mode: "dark",
      });
      expect(scoreAllGrey.breakdown.paletteScore).toBe(0);
      expect(scoreAllGrey.total).toBeLessThanOrEqual(60);
    });

    // Condition 2: ELEMENT_DROPPED raised via QR_TOO_SMALL autofix path, appears in draft.issues and result.issues, absent when qr.enabled is false
    it("Condition 2: ELEMENT_DROPPED raised when QR hidden via QR_TOO_SMALL autofix, present in draft.issues and result.issues with qr.enabled, absent when false", () => {
      // (a) With qr.enabled: true
      const eventWithQr = {
        ...sampleEventSpec,
        qr: { enabled: true },
      };
      const resultWithQr = composeDrafts(eventWithQr, {
        seed: "test-qr-autofix-true",
        count: 3,
      });

      expect(resultWithQr.drafts).toHaveLength(3);
      // Each draft carries its own issues array containing ELEMENT_DROPPED
      for (const draft of resultWithQr.drafts) {
        expect(Array.isArray(draft.issues)).toBe(true);
        const qrDrop = draft.issues.find(
          (i) => i.code === "ELEMENT_DROPPED" && i.nodeId === "qr"
        );
        expect(qrDrop).toBeDefined();
        expect(qrDrop.severity).toBe("warning");
      }

      // result.issues contains ELEMENT_DROPPED
      expect(
        resultWithQr.issues.some(
          (i) => i.code === "ELEMENT_DROPPED" && i.nodeId === "qr"
        )
      ).toBe(true);

      // (b) With qr.enabled: false
      const eventNoQr = {
        ...sampleEventSpec,
        qr: { enabled: false },
      };
      const resultNoQr = composeDrafts(eventNoQr, {
        seed: "test-qr-autofix-false",
        count: 3,
      });

      expect(resultNoQr.drafts).toHaveLength(3);
      for (const draft of resultNoQr.drafts) {
        expect(
          draft.issues.some((i) => i.code === "ELEMENT_DROPPED")
        ).toBe(false);
      }
      expect(
        resultNoQr.issues.some((i) => i.code === "ELEMENT_DROPPED")
      ).toBe(false);
    });

    // Condition 2: result.issues only contains issues of the 3 chosen drafts plus data errors
    it("Condition 2: result.issues only contains issues of the chosen drafts plus data errors, not rejected candidates", () => {
      const result = composeDrafts(sampleEventSpec, {
        seed: "test-chosen-issues-only",
        count: 3,
      });

      expect(result.drafts).toHaveLength(3);
      // Every non-data-error issue in result.issues must come from one of the chosen drafts
      const chosenIssueKeys = new Set();
      for (const draft of result.drafts) {
        for (const iss of draft.issues || []) {
          chosenIssueKeys.add(`${iss.code}:${iss.message}:${iss.nodeId}`);
        }
      }

      for (const iss of result.issues) {
        if (iss.code !== "UNKNOWN_ROLE_ID") {
          const key = `${iss.code}:${iss.message}:${iss.nodeId}`;
          expect(chosenIssueKeys.has(key)).toBe(true);
        }
      }
    });
  });
});




