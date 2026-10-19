/**
 * Automated preflight regression harness measuring bottom-stack gaps (>= 2.0 mm),
 * text size floors (>= 5.5 pt), and drop rates across 3,840 cards (20 seeds x 4 archetypes x 3 modes x 2 QR settings x 8 stress people).
 *
 * Usage:
 *   node scripts/measure-cards.js
 */
// @ts-check
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import { sampleBrandKit, sampleEventSpec } from "../core/fixtures.js";
import { stressSet } from "../core/stressSet.js";
import { compose, scoreQuality } from "../core/composer.js";
import { renderCard } from "../core/render.js";
import { PT_TO_MM } from "../core/text.js";

function loadFont(relPath) {
  const p = resolve(process.cwd(), relPath);
  const buf = readFileSync(p);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const fontRegistry = {
  "space-grotesk": {
    heading: loadFont("assets/fonts/SpaceGrotesk-Bold.ttf"),
    body: loadFont("assets/fonts/Inter-Regular.ttf"),
  },
  "source-serif": {
    heading: loadFont("assets/fonts/SourceSerif4-Bold.ttf"),
    body: loadFont("assets/fonts/SourceSans3-Regular.ttf"),
  },
};

const ARCHETYPES = [
  "hero-photo-top",
  "colour-block-split",
  "circle-badge-centre",
  "typographic-name-first",
];
const MODES = ["light", "dark", "colour-field"];
const NUM_SEEDS = 20;

/**
 * Bottom-stack block IDs of interest.
 * Elements like 'role' (text inside pill) or 'qr-label' (text inside qr-box)
 * are nested inside their container and not separate stacked blocks.
 */
const BOTTOM_STACK_IDS = new Set([
  "name",
  "org",
  "role-pill",
  "pill",
  "id-line",
  "qr-box",
  "role-bar",
  "roleMarker",
  "venue-label",
  "footer",
]);

/**
 * Calculates the smallest gap between vertically stacked blocks in the bottom stack.
 *
 * @param {any[]} scene
 * @returns {{ minGapMm: number, gapDetails: any[] }}
 */
export function measureBottomStackGaps(scene) {
  // Collect bottom-stack candidate blocks
  const blocks = scene.filter((n) => {
    if (!n.box || n.id === "bg") return false;
    // Exclude header elements
    if (n.id === "logo1" || n.id === "logo2" || n.id === "logos-plate" || n.id === "event-name" || n.id === "band") {
      return false;
    }
    // Exclude photo
    if (n.id === "photo") return false;
    // Exclude text nested inside containers
    if (n.id === "role" || n.id === "qr-label") return false;

    // Must be in bottom stack set or positioned in lower region
    if (BOTTOM_STACK_IDS.has(n.id)) {
      // If role-bar is a left vertical strip (x < 5, w < 5, h > 50), it is not a horizontal stacked bar
      if ((n.id === "role-bar" || n.id === "roleMarker") && n.box.h > 40) {
        return false;
      }
      return true;
    }
    return false;
  });

  const gapDetails = [];
  let minGapMm = Infinity;

  for (let i = 0; i < blocks.length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i === j) continue;
      const a = blocks[i];
      const b = blocks[j];

      // We only measure when b is below a
      if (b.box.y < a.box.y) continue;

      // Check horizontal overlap between a and b
      const xOverlap = Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x);
      if (xOverlap <= 0.5) continue; // No significant horizontal overlap

      // Check if there is an intermediate block c between a and b that also overlaps horizontally
      let intermediate = false;
      for (let k = 0; k < blocks.length; k++) {
        if (k === i || k === j) continue;
        const c = blocks[k];
        if (c.box.y >= a.box.y && c.box.y + c.box.h <= b.box.y + 0.1) {
          const cOverlap = Math.min(Math.min(a.box.x + a.box.w, b.box.x + b.box.w), c.box.x + c.box.w) -
                          Math.max(Math.max(a.box.x, b.box.x), c.box.x);
          if (cOverlap > 0.5 && c.box.y > a.box.y && c.box.y < b.box.y) {
            intermediate = true;
            break;
          }
        }
      }

      if (intermediate) continue;

      // Vertical gap
      const gap = b.box.y - (a.box.y + a.box.h);
      gapDetails.push({
        topId: a.id,
        bottomId: b.id,
        topBox: a.box,
        bottomBox: b.box,
        gapMm: Math.round(gap * 1000) / 1000,
      });

      if (gap < minGapMm) {
        minGapMm = gap;
      }
    }
  }

  return {
    minGapMm: minGapMm === Infinity ? 0 : Math.round(minGapMm * 1000) / 1000,
    gapDetails,
  };
}

/**
 * Measures smallest font size (pt) across all text nodes in the scene.
 *
 * @param {any[]} scene
 * @returns {number}
 */
export function measureMinTextSizePt(scene) {
  let minPt = Infinity;
  for (const node of scene) {
    if (node.type === "text" && typeof node.sizeMm === "number") {
      const pt = node.sizeMm / PT_TO_MM;
      if (pt < minPt) {
        minPt = pt;
      }
    }
  }
  return minPt === Infinity ? 0 : Math.round(minPt * 100) / 100;
}

export function runMeasurements() {
  const cards = [];
  let minGapOverall = Infinity;
  let minTextOverall = Infinity;
  let brokenCardsCount = 0;

  for (let s = 1; s <= NUM_SEEDS; s++) {
    const seed = `measure-seed-${s}`;

    for (const archetype of ARCHETYPES) {
      for (const mode of MODES) {
        const bundle = compose(sampleEventSpec, seed, archetype, mode);
        const fonts = fontRegistry[bundle.look.attributes.typography] || fontRegistry["space-grotesk"];

        for (const qrEnabled of [true, false]) {
          const eventSpec = {
            ...sampleEventSpec,
            qr: {
              ...sampleEventSpec.qr,
              enabled: qrEnabled,
            },
          };

          for (const person of stressSet) {
            const res = renderCard({
              person,
              event: eventSpec,
              brand: sampleBrandKit,
              card: eventSpec.card,
              fonts,
              skeleton: bundle.skeleton,
              blocks: bundle.blocks,
              theme: bundle.theme,
              look: bundle.look,
            });

            const { minGapMm, gapDetails } = measureBottomStackGaps(res.scene);
            const minTextPt = measureMinTextSizePt(res.scene);

            const score = scoreQuality(res.scene, {
              card: eventSpec.card,
              event: eventSpec,
              theme: bundle.theme,
              palette: eventSpec?.event?.palette || ["#0A192F", "#FF6B35"],
            });
            const paletteScore = score.breakdown?.paletteScore ?? 0;

            if (minGapMm < minGapOverall) minGapOverall = minGapMm;
            if (minTextPt < minTextOverall) minTextOverall = minTextPt;

            const breaksGapRule = minGapMm < 2.0;
            const breaksTextRule = minTextPt < 5.5;
            const isBroken = breaksGapRule || breaksTextRule;

            if (isBroken) {
              brokenCardsCount++;
            }

            const droppedIssues = (res.issues || []).filter((i) => i.code === "ELEMENT_DROPPED");
            const fixes = res.fixes || [];
            const qrDropped = qrEnabled && (droppedIssues.some((i) => i.nodeId === "qr" || i.nodeId === "qr-box") || fixes.some((f) => f.nodeId === "qr-box" || f.nodeId === "qr-label"));
            const orgDropped = droppedIssues.some((i) => i.nodeId === "org") || fixes.some((f) => f.nodeId === "org");
            const idDropped = droppedIssues.some((i) => i.nodeId === "id-line" || i.nodeId === "id") || fixes.some((f) => f.nodeId === "id-line" || f.nodeId === "id");

            cards.push({
              seed,
              archetype,
              mode,
              qrEnabled,
              personId: person.id,
              minGapMm,
              minTextPt,
              paletteScore,
              breaksGapRule,
              breaksTextRule,
              isBroken,
              gapDetails,
              qrDropped,
              orgDropped,
              idDropped,
            });
          }
        }
      }
    }
  }

  // Aggregate drops per archetype
  const dropsByArchetype = {};
  for (const arch of ARCHETYPES) {
    dropsByArchetype[arch] = { qr: 0, org: 0, idLine: 0, total: 0 };
  }
  for (const c of cards) {
    dropsByArchetype[c.archetype].total++;
    if (c.qrDropped) dropsByArchetype[c.archetype].qr++;
    if (c.orgDropped) dropsByArchetype[c.archetype].org++;
    if (c.idDropped) dropsByArchetype[c.archetype].idLine++;
  }

  // Sort to find 5 worst cards (lowest gap first, then lowest text size)
  const sortedWorst = [...cards].sort((a, b) => {
    if (a.minGapMm !== b.minGapMm) return a.minGapMm - b.minGapMm;
    return a.minTextPt - b.minTextPt;
  });

  const worst5 = sortedWorst.slice(0, 5);

  return {
    totalCards: cards.length,
    minGapOverall: Math.round(minGapOverall * 1000) / 1000,
    minTextOverall: Math.round(minTextOverall * 100) / 100,
    brokenCardsCount,
    worst5,
    dropsByArchetype,
  };
}

if (process.argv[1] && process.argv[1].endsWith("measure-cards.js")) {
  console.log("Measuring cards across archetypes x modes x stressSet x QR x seeds...");
  const t0 = Date.now();
  const results = runMeasurements();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  console.log(`\n=== MEASUREMENT REPORT (${elapsed}s) ===`);
  console.log(`Total Cards Evaluated: ${results.totalCards}`);
  console.log(`Smallest Gap in Bottom Stack: ${results.minGapOverall} mm (Rule: >= 2.0 mm)`);
  console.log(`Smallest Text Size: ${results.minTextOverall} pt (Rule: >= 5.5 pt)`);
  console.log(`Cards Breaking a Rule: ${results.brokenCardsCount} / ${results.totalCards} (${((results.brokenCardsCount / results.totalCards) * 100).toFixed(1)}%)`);

  console.log(`\n=== DROPS PER ARCHETYPE ===`);
  console.log(`Archetype                | Total | QR Drops (%)      | Org Drops (%)     | ID-Line Drops (%)`);
  console.log(`-------------------------|-------|-------------------|-------------------|------------------`);
  for (const [arch, stats] of Object.entries(results.dropsByArchetype)) {
    const qrPct = ((stats.qr / stats.total) * 100).toFixed(1);
    const orgPct = ((stats.org / stats.total) * 100).toFixed(1);
    const idPct = ((stats.idLine / stats.total) * 100).toFixed(1);
    console.log(`${arch.padEnd(24)} | ${String(stats.total).padEnd(5)} | ${String(stats.qr).padStart(4)} (${qrPct.padStart(4)}%)   | ${String(stats.org).padStart(4)} (${orgPct.padStart(4)}%)   | ${String(stats.idLine).padStart(4)} (${idPct.padStart(4)}%)`);
  }

  console.log(`\n=== 5 WORST CARDS ===`);
  results.worst5.forEach((c, idx) => {
    console.log(`${idx + 1}. Archetype: ${c.archetype} | Mode: ${c.mode} | Seed: ${c.seed} | Person: ${c.personId} | QR: ${c.qrEnabled}`);
    console.log(`   Min Gap: ${c.minGapMm} mm | Min Text: ${c.minTextPt} pt | Pal: ${c.paletteScore}`);
    if (c.gapDetails && c.gapDetails.length > 0) {
      const smallest = c.gapDetails.slice().sort((x, y) => x.gapMm - y.gapMm)[0];
      console.log(`   Worst Gap: ${smallest.topId} -> ${smallest.bottomId} = ${smallest.gapMm} mm`);
    }
  });
}
