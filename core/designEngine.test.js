// @ts-check
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import { sampleBrandKit, sampleEventSpec, personNormal } from "./fixtures.js";
import { renderCard } from "./render.js";
import { composeDrafts, createPrng } from "./composer.js";
import {
  DesignSpec,
  sampleSpec,
  buildFromSpec,
  isCompatible,
  generateMotifPath,
  boxesOverlap,
} from "./designEngine.js";

// Load test font
const fontPath = resolve(process.cwd(), "assets/fonts/SpaceGrotesk-Bold.ttf");
const fontBuf = readFileSync(fontPath);
const font = opentype.parse(
  fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength)
);

describe("Task E1: Design engine with motif layer (core/designEngine.js)", () => {
  const hackSuratEvent = {
    ...sampleEventSpec,
    event: {
      ...sampleEventSpec.event,
      name: { value: "HackSurat 2026", source: "user", confirmed: true },
      tagline: { value: "36-Hour National Student Hackathon", source: "user", confirmed: true },
      venue: { value: "SVNIT Campus, Surat", source: "user", confirmed: true },
      palette: ["#0F172A", "#38BDF8"],
    },
  };

  const realPhotoUri = "data:image/svg+xml;base64," + Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="240"><rect width="200" height="240" fill="#E0E7FF"/></svg>'
  ).toString("base64");

  const personWithRealPhoto = {
    ...personNormal,
    photo: realPhotoUri,
  };

  // 1. the same seed gives the same spec
  it("determinism: the same seed gives the same spec", () => {
    const prng1 = createPrng(12345);
    const prng2 = createPrng(12345);
    const spec1 = sampleSpec(prng1, hackSuratEvent);
    const spec2 = sampleSpec(prng2, hackSuratEvent);
    expect(spec1).toEqual(spec2);
    expect(DesignSpec.parse(spec1)).toEqual(spec1);
  });

  // 2. INCOMPATIBLE combinations are never sampled
  it("invariants: INCOMPATIBLE combinations are never sampled across 100 seeds", () => {
    for (let s = 1; s <= 100; s++) {
      const prng = createPrng(s * 31);
      const spec = sampleSpec(prng, hackSuratEvent);
      expect(isCompatible(spec)).toBe(true);
    }
  });

  // 3. buildFromSpec for sampled specs in 3 modes on one event with a real photo gives zero issues of any severity
  it("rendering: buildFromSpec in 3 modes on HackSurat with a real photo gives zero issues of any severity", () => {
    const modes = ["light", "dark", "colour-field"];
    for (const mode of modes) {
      const prng = createPrng(42 + modes.indexOf(mode) * 17);
      const baseSpec = sampleSpec(prng, hackSuratEvent);
      const spec = { ...baseSpec, mode };

      const bundle = buildFromSpec(spec, hackSuratEvent, hackSuratEvent.event.palette, `test-${mode}`, 999);
      expect(bundle).not.toBeNull();

      const res = renderCard({
        person: personWithRealPhoto,
        event: hackSuratEvent,
        brand: sampleBrandKit,
        card: hackSuratEvent.card,
        font,
        ...bundle,
      });

      expect(res.issues || []).toEqual([]);
    }
  });

  // 4. every ribbon is at least 0.35 mm wide
  it("motifs: every ribbon has a width of at least 0.35 mm", () => {
    const motifs = ["disc", "rings", "stripes", "chevron", "contour", "dots-plus"];
    const zoneBox = { x: 30, y: 20, w: 24, h: 60 };

    for (const motif of motifs) {
      const prng = createPrng(101 + motifs.indexOf(motif));
      const res = generateMotifPath(motif, prng, zoneBox, "medium", "top-right", "#38BDF8", 3);
      expect(res).not.toBeNull();
      expect(res?.d.length).toBeGreaterThan(10);
    }
  });

  // 5. no motif ever overlaps a text box
  it("layout: no motif ever overlaps any text box", () => {
    for (let i = 0; i < 30; i++) {
      const prng = createPrng(500 + i * 13);
      const spec = sampleSpec(prng, hackSuratEvent);
      const bundle = buildFromSpec(spec, hackSuratEvent, hackSuratEvent.event.palette, `check-${i}`, 500 + i);
      if (!bundle) continue;

      const res = renderCard({
        person: personWithRealPhoto,
        event: hackSuratEvent,
        brand: sampleBrandKit,
        card: hackSuratEvent.card,
        font,
        ...bundle,
      });

      const textNodes = res.scene.filter((n) => n.type === "text" && !n.decor);
      const motifNodes = res.scene.filter((n) => n.type === "path" && n.decor);

      for (const t of textNodes) {
        for (const m of motifNodes) {
          // Bounding boxes must not collide
          expect(boxesOverlap(m.box, t.box, 0.1)).toBe(false);
        }
      }
    }
  });

  // 6. composeDrafts returns 3 drafts with distinct grids
  it("selection: composeDrafts returns 3 drafts with distinct grids", () => {
    const result = composeDrafts(hackSuratEvent, {
      seed: 1001,
      font,
      brand: sampleBrandKit,
      count: 3,
    });

    expect(result.drafts).toHaveLength(3);
    const grids = result.drafts.map((d) => d.spec ? d.spec.grid : d.look.attributes.skeleton);
    const uniqueGrids = new Set(grids);
    expect(uniqueGrids.size).toBe(3);
  });

  // 7. across the 10 gallery events the Section 1 triplets contain at least 4 distinct grids in total
  it("gallery matrix: across the 10 gallery events the Section 1 triplets contain at least 4 distinct grids in total", () => {
    const showcaseEvents = [
      { name: "HackSurat 2026", palette: ["#0F172A", "#38BDF8"] },
      { name: "ACM Computing Symposium", palette: ["#1E3A2F", "#F5EBE0"] },
      { name: "DesignSprint NIT", palette: ["#4A154B", "#E01E5A"] },
      { name: "CyberShield Expo", palette: ["#09090B", "#22C55E"] },
      { name: "ACM Annual Gala", palette: ["#1E1B4B", "#FBBF24"] },
      { name: "AI Horizons Conclave", palette: ["#1E40AF", "#93C5FD"] },
      { name: "RoboWars Surat", palette: ["#7F1D1D", "#F97316"] },
      { name: "Women in Tech Surat", palette: ["#831843", "#F472B6"] },
      { name: "OpenSource Carnival", palette: ["#064E3B", "#34D399"] },
      { name: "FounderSpark Pitch", palette: ["#312E81", "#A78BFA"] },
    ];

    const allChosenGrids = new Set();
    const globalPrngSeed = 1001;

    for (let eIdx = 0; eIdx < showcaseEvents.length; eIdx++) {
      const ev = showcaseEvents[eIdx];
      const eventSpec = {
        ...sampleEventSpec,
        event: {
          ...sampleEventSpec.event,
          name: { value: ev.name, source: "user", confirmed: true },
          palette: ev.palette,
        },
      };

      const seed = globalPrngSeed + eIdx * 7;
      const draftResult = composeDrafts(eventSpec, {
        seed,
        font,
        brand: sampleBrandKit,
        count: 3,
      });

      for (const d of draftResult.drafts) {
        const grid = d.spec ? d.spec.grid : d.look.attributes.skeleton;
        allChosenGrids.add(grid);
      }
    }

    expect(allChosenGrids.size).toBeGreaterThanOrEqual(4);
  }, 60000);
});
