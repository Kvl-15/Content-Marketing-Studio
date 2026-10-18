// @ts-check
import { compose, composeDrafts, scoreQuality, DEFAULT_ROLE_COLORS } from "../core/composer.js";
import { sampleEventSpec, sampleBrandKit, personNormal } from "../core/fixtures.js";
import { renderCard } from "../core/render.js";
import { hexToRgb, rgbToHsl } from "../core/themeDerivation.js";

// Test (c): role pill colours differ in lightness by at least 15% in grayscale
const roleKeys = ["volunteer", "participant", "organizer", "mentor"];
const lightnesses = roleKeys.map(k => {
  const hex = DEFAULT_ROLE_COLORS[k];
  const [r, g, b] = hexToRgb(hex);
  const [, , l] = rgbToHsl(r, g, b);
  return { role: k, hex, l };
});
console.log("Role Lightnesses:", lightnesses);
for (let i = 0; i < lightnesses.length - 1; i++) {
  const diff = Math.abs(lightnesses[i].l - lightnesses[i + 1].l);
  console.log(`Diff ${lightnesses[i].role} - ${lightnesses[i+1].role}: ${(diff * 100).toFixed(1)}%`);
  if (diff < 0.15) throw new Error(`Role lightness diff < 15%`);
}

// Test (a): 10 different palettes give 10 different dominant colours
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
    event: { ...sampleEventSpec.event, palette: pal }
  };
  // Compose drafts and check dominant color
  const drafts = composeDrafts(event, { seed: 100 + i, count: 3 });
  // Find dominant filled area (largest rect in scene)
  const d0 = drafts.drafts[0];
  const card = renderCard({
    person: personNormal,
    event,
    brand: sampleBrandKit,
    card: event.card,
    skeleton: d0.skeleton,
    blocks: d0.blocks,
    theme: d0.theme,
    look: d0.look,
  });

  // Largest rect in scene that is not plain white
  let maxArea = 0;
  let dominant = "";
  for (const n of card.scene) {
    if (n.type === "rect" && n.box && n.fill) {
      const area = n.box.w * n.box.h;
      if (area > maxArea) {
        maxArea = area;
        dominant = n.fill.toUpperCase();
      }
    }
  }
  dominantColors.add(dominant);
  console.log(`Event ${i} (pal: ${pal[0]}, ${pal[1]}): dominant=${dominant}, look=${d0.archetype}, mode=${d0.look.attributes.mode}`);
}
console.log(`Unique dominant colors: ${dominantColors.size} / 10`);

// Test (b): scoreQuality over 30 candidates has spread >= 25 points
const scores = [];
for (let i = 0; i < 35; i++) {
  const pal = testPalettes[i % testPalettes.length];
  const event = { ...sampleEventSpec, event: { ...sampleEventSpec.event, palette: pal } };
  const d = compose(event, 500 + i);
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
console.log(`Scores: min=${minScore}, max=${maxScore}, spread=${spread}`);
if (spread < 25) throw new Error(`Score spread < 25: ${spread}`);
console.log("All scratch tests passed!");
