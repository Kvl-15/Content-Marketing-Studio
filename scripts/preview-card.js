import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import { renderCard } from "../core/render.js";
import * as fixtures from "../core/fixtures.js";

// Discover all exported person fixtures
const availablePersons = Object.fromEntries(
  Object.entries(fixtures).filter(
    ([key, val]) =>
      key.startsWith("person") &&
      val &&
      typeof val === "object" &&
      typeof val.name === "string"
  )
);

const personName = process.argv[2] || "personNormal";

if (!availablePersons[personName]) {
  console.error(
    `Person "${personName}" not found in fixtures. Available persons: ${Object.keys(availablePersons).join(", ")}`
  );
  process.exit(1);
}

const fontPath = resolve(process.cwd(), "assets/fonts/Roboto-VariableFont_wdth,wght.ttf");
const fontBuf = readFileSync(fontPath);
const font = opentype.parse(
  fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength)
);

const person = availablePersons[personName];
const result = renderCard({
  person,
  event: fixtures.sampleEventSpec,
  brand: fixtures.sampleBrandKit,
  card: fixtures.sampleEventSpec.card,
  font,
});

const outFile = `card-${personName}.svg`;
writeFileSync(outFile, result.svg, "utf8");
console.log(`Saved ${outFile}`);

for (const issue of result.issues) {
  console.log(`${issue.severity}, ${issue.code}, ${issue.nodeId ?? ""}, ${issue.message}`);
}
