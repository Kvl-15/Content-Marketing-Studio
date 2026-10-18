// @ts-check
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import {
  personLongName,
  personNoPhoto,
  personNormal,
  sampleBrandKit,
  sampleEventSpec,
} from "../core/fixtures.js";
import { renderCard } from "../core/render.js";
import { loadContent } from "./loadContent.js";

const fontPath = resolve(process.cwd(), "assets/fonts/Roboto-VariableFont_wdth,wght.ttf");
const fontBuf = readFileSync(fontPath);
const font = opentype.parse(
  fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength)
);

const { skeletons, blocks, themes, looks, brandKits } = loadContent();

const usePlaceholder = process.argv.includes("--placeholder");
const activeBrandKit = usePlaceholder
  ? (brandKits["acm-nitsurat"] || sampleBrandKit)
  : (brandKits["test-logos"] || sampleBrandKit);

console.log(
  `Generating gallery with ${usePlaceholder ? "placeholder logos" : 'real test logos ("test-logos" brand kit)'}...`
);

const palettes = [
  { name: "Navy + Orange", colors: ["#0A192F", "#FF6B35"] },
  { name: "Green + Cream", colors: ["#1E3A2F", "#F5EBE0"] },
  { name: "Purple + Pink", colors: ["#4A154B", "#E01E5A"] },
  { name: "Red + Black", colors: ["#DC2626", "#18181B"] },
  { name: "Teal + Yellow", colors: ["#0D9488", "#FBBF24"] },
  { name: "Pale Pastel", colors: ["#BAE6FD", "#FBCFE8"] },
];

const eventWithRoles = {
  ...sampleEventSpec,
  roles: [
    { id: "participant", label: "PARTICIPANT", expectedCount: 200, color: { value: "#2563EB" } },
    { id: "mentor", label: "MENTOR", expectedCount: 20, color: { value: "#16A34A" } },
    { id: "organizer", label: "ORGANIZER", expectedCount: 15, color: { value: "#9333EA" } },
  ],
};

const lookKeys = [
  "look.bold",
  "look.minimal",
  "look.tech",
  "look.formal",
  "look.playful",
  "look.editorial",
];

// Build HTML gallery
let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ACM NIT Surat Card Studio - Look Gallery</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0B0F19; color: #F3F4F6; margin: 0; padding: 24px; }
    h1, h2 { color: #FFFFFF; border-bottom: 1px solid #1F2937; padding-bottom: 8px; }
    .grid { display: grid; grid-template-columns: 140px repeat(6, 180px); gap: 16px; align-items: start; margin-bottom: 40px; overflow-x: auto; }
    .header-cell { font-weight: bold; font-size: 14px; text-transform: uppercase; color: #9CA3AF; padding: 8px 4px; text-align: center; }
    .row-label { font-weight: 600; font-size: 13px; color: #E5E7EB; display: flex; flex-direction: column; justify-content: center; height: 285px; }
    .palette-swatch { display: flex; gap: 4px; margin-top: 6px; }
    .swatch { width: 16px; height: 16px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.2); }
    .card-cell { background: #111827; border: 1px solid #374151; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; align-items: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.4); }
    .svg-container { width: 150px; height: 238px; display: flex; justify-content: center; align-items: center; }
    .svg-container svg { width: 100%; height: 100%; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); border-radius: 4px; }
    .card-meta { margin-top: 8px; font-size: 11px; text-align: center; color: #9CA3AF; line-height: 1.4; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 9999px; font-size: 10px; font-weight: 600; margin-top: 4px; }
    .badge-ok { background: #064E3B; color: #6EE7B7; }
    .badge-warn { background: #78350F; color: #FCD34D; }
    .badge-err { background: #7F1D1D; color: #FCA5A5; }
  </style>
</head>
<body>
  <h1>ID Card Studio - Look Gallery (Task 7B)</h1>
  <p>6 Distinct Looks × 6 Event Palettes. Rendered with pure theme derivation (D-24) and guaranteed distinctness (D-25).</p>

  <h2>Section 1: Main Matrix (personNormal)</h2>
  <div class="grid">
    <div class="header-cell">Palette</div>
`;

for (const key of lookKeys) {
  const l = looks[key];
  html += `<div class="header-cell">${l.id.replace("look.", "")}<br><span style="font-size:10px; font-weight:normal; text-transform:none;">${l.attributes.skeleton} / ${l.attributes.theme}</span></div>`;
}

// Section 1 rows
for (const pal of palettes) {
  html += `<div class="row-label">
    <div>${pal.name}</div>
    <div class="palette-swatch">
      ${pal.colors.map((c) => `<div class="swatch" style="background:${c}"></div>`).join("")}
    </div>
  </div>`;

  for (const key of lookKeys) {
    const l = looks[key];
    const skel = skeletons[l.skeleton];
    const res = renderCard({
      person: personNormal,
      event: eventWithRoles,
      brand: activeBrandKit,
      skeleton: skel,
      blocks,
      look: l,
      palette: pal.colors,
      font,
    });

    const errorCount = res.issues.filter((i) => i.severity === "error").length;
    const warnCount = res.issues.filter((i) => i.severity === "warning").length;
    const badgeClass = errorCount > 0 ? "badge-err" : warnCount > 0 ? "badge-warn" : "badge-ok";
    const statusText = errorCount > 0 ? `${errorCount} errors` : warnCount > 0 ? `${warnCount} warn` : "valid";

    html += `
      <div class="card-cell">
        <div class="svg-container">${res.svg}</div>
        <div class="card-meta">
          <div><strong>${l.id.replace("look.", "")}</strong></div>
          <span class="badge ${badgeClass}">${statusText}</span>
          ${res.fixes.length > 0 ? `<div style="color:#60A5FA;">autofix: ${res.fixes.length}</div>` : ""}
        </div>
      </div>
    `;
  }
}

html += `</div>

  <h2>Section 2: Stress Variants (personLongName & personNoPhoto)</h2>
  <div class="grid" style="grid-template-columns: 140px repeat(6, 180px);">
    <div class="header-cell">Stress Case</div>
`;

for (const key of lookKeys) {
  html += `<div class="header-cell">${key.replace("look.", "")}</div>`;
}

const stressCases = [
  { label: "Long Name (Navy+Orange)", person: personLongName, palette: palettes[0].colors },
  { label: "No Photo (Teal+Yellow)", person: personNoPhoto, palette: palettes[4].colors },
];

for (const sc of stressCases) {
  html += `<div class="row-label"><div>${sc.label}</div></div>`;

  for (const key of lookKeys) {
    const l = looks[key];
    const skel = skeletons[l.skeleton];
    const res = renderCard({
      person: sc.person,
      event: eventWithRoles,
      brand: activeBrandKit,
      skeleton: skel,
      blocks,
      look: l,
      palette: sc.palette,
      font,
    });

    const errorCount = res.issues.filter((i) => i.severity === "error").length;
    const warnCount = res.issues.filter((i) => i.severity === "warning").length;
    const badgeClass = errorCount > 0 ? "badge-err" : warnCount > 0 ? "badge-warn" : "badge-ok";
    const statusText = errorCount > 0 ? `${errorCount} errors` : warnCount > 0 ? `${warnCount} warn` : "valid";

    html += `
      <div class="card-cell">
        <div class="svg-container">${res.svg}</div>
        <div class="card-meta">
          <span class="badge ${badgeClass}">${statusText}</span>
          ${res.fixes.length > 0 ? `<div style="color:#60A5FA;">autofix: ${res.fixes.length}</div>` : ""}
        </div>
      </div>
    `;
  }
}

html += `
  </div>
</body>
</html>`;

writeFileSync("gallery.html", html, "utf8");
console.log("Gallery generated successfully: gallery.html");
