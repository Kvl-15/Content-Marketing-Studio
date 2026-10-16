import { writeFileSync } from "node:fs";
import { renderCard } from "../core/render.js";
import { personNormal, sampleBrandKit, sampleEventSpec } from "../core/fixtures.js";

const result = renderCard({
  person: personNormal,
  event: sampleEventSpec,
  brand: sampleBrandKit,
  card: sampleEventSpec.card,
});

writeFileSync("./card.svg", result.svg, "utf8");

console.log("SVG saved to card.svg");
console.log("Scene nodes:", result.scene.length);
console.log("Issues:", result.issues.length);
