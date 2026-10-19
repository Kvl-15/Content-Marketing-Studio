// @ts-check
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import {
  personLongName,
  personNormal,
  sampleBrandKit,
  sampleEventSpec,
} from "../core/fixtures.js";
import { renderCard } from "../core/render.js";
import { compose, composeDrafts, DEFAULT_ROLE_COLORS, scoreQuality } from "../core/composer.js";
import { loadContent } from "./loadContent.js";

// Load fonts
function loadFont(relPath) {
  const p = resolve(process.cwd(), relPath);
  const buf = readFileSync(p);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const fontRegistry = {
  "space-grotesk": {
    heading: loadFont("assets/fonts/SpaceGrotesk-Bold.ttf"),
    body: loadFont("assets/fonts/Inter-Regular.ttf"),
    label: "Space Grotesk + Inter",
  },
  "source-serif": {
    heading: loadFont("assets/fonts/SourceSerif4-Bold.ttf"),
    body: loadFont("assets/fonts/SourceSans3-Regular.ttf"),
    label: "Source Serif 4 + Source Sans 3",
  },
  "default": {
    heading: loadFont("assets/fonts/SpaceGrotesk-Bold.ttf"),
    body: loadFont("assets/fonts/Inter-Regular.ttf"),
    label: "Space Grotesk + Inter",
  },
};
const font = fontRegistry.default.heading;

// Load content and brand kit
const { brandKits } = loadContent();
const activeBrandKit = brandKits["test-logos"] || brandKits["acm-nitsurat"] || sampleBrandKit;

// ═══════════════════════════════════════════════════════════════════════
//  Realistic SVG Placeholder Avatars (Scripts Only, flat vector shapes)
// ═══════════════════════════════════════════════════════════════════════
function createAvatarDataUri(bg, skin, hair, clothes) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240" width="200" height="240">
    <rect width="200" height="240" fill="${bg}"/>
    <!-- Torso / Clothes -->
    <path d="M30 240 Q30 180 100 180 Q170 180 170 240 Z" fill="${clothes}"/>
    <!-- Neck -->
    <rect x="85" y="140" width="30" height="40" rx="6" fill="${skin}"/>
    <!-- Head / Face -->
    <ellipse cx="100" cy="115" rx="42" ry="52" fill="${skin}"/>
    <!-- Hair -->
    <path d="${hair}" fill="#1E293B"/>
    <!-- Simple eyes and smile -->
    <circle cx="86" cy="112" r="3.5" fill="#0F172A"/>
    <circle cx="114" cy="112" r="3.5" fill="#0F172A"/>
    <path d="M92 135 Q100 144 108 135" stroke="#0F172A" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const avatars = [
  createAvatarDataUri("#E0E7FF", "#FBCFE8", "M58 110 C56 70 75 60 100 60 C125 60 144 70 142 110 C138 90 120 78 100 78 C80 78 62 90 58 110 Z", "#3B82F6"),
  createAvatarDataUri("#FEF3C7", "#FED7AA", "M55 125 C50 65 80 55 100 55 C120 55 150 65 145 125 C140 85 125 72 100 72 C75 72 60 85 55 125 Z", "#10B981"),
  createAvatarDataUri("#DCFCE7", "#FDE047", "M60 105 C55 60 70 52 100 52 C130 52 145 60 140 105 C135 75 122 68 100 68 C78 68 65 75 60 105 Z", "#8B5CF6"),
  createAvatarDataUri("#FCE7F3", "#FCD34D", "M56 120 C52 70 74 58 100 58 C126 58 148 70 144 120 C140 82 120 74 100 74 C80 74 60 82 56 120 Z", "#EF4444"),
];

// ═══════════════════════════════════════════════════════════════════════
//  10 Realistic Fake Events
// ═══════════════════════════════════════════════════════════════════════
const showcaseEvents = [
  {
    name: "HackSurat 2026",
    tagline: "36-Hour National Student Hackathon",
    palette: ["#0F172A", "#38BDF8"],
    venue: "SVNIT Campus, Surat",
  },
  {
    name: "ACM Computing Symposium",
    tagline: "Advances in Systems and Machine Learning",
    palette: ["#1E3A2F", "#F5EBE0"],
    venue: "Central Seminar Hall",
  },
  {
    name: "DesignSprint NIT",
    tagline: "Product Strategy & UI/UX Sprint",
    palette: ["#4A154B", "#E01E5A"],
    venue: "Design Innovation Centre",
  },
  {
    name: "CyberShield Expo",
    tagline: "Defense, Forensics and Zero-Trust",
    palette: ["#09090B", "#22C55E"],
    venue: "Auditorium A",
  },
  {
    name: "ACM Annual Gala",
    tagline: "Celebrating 15 Years of Excellence",
    palette: ["#1E1B4B", "#FBBF24"],
    venue: "Grand Ballroom, Surat",
  },
  {
    name: "AI Horizons Conclave",
    tagline: "Foundation Models in Production",
    palette: ["#1E40AF", "#93C5FD"],
    venue: "Computer Science Dept",
  },
  {
    name: "RoboWars Surat",
    tagline: "Combat Robotics Championship",
    palette: ["#7F1D1D", "#F97316"],
    venue: "Mechanical Quadrangle",
  },
  {
    name: "Women in Tech Surat",
    tagline: "Empowering Next-Gen Tech Leaders",
    palette: ["#831843", "#F472B6"],
    venue: "Student Activity Center",
  },
  {
    name: "OpenSource Carnival",
    tagline: "Code, Collaborate, and Contribute",
    palette: ["#064E3B", "#34D399"],
    venue: "Open Air Theatre",
  },
  {
    name: "FounderSpark Pitch",
    tagline: "Student Startups Demo Day",
    palette: ["#312E81", "#A78BFA"],
    venue: "Incubation Center",
  },
];

console.log("Composing C2c fix round drafts for 10 events x 3 seeds + 5-seed showcase...");

// HTML template
let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ACM NIT Surat Card Studio - Dynamic Composer Spike (Round C2c)</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0B0F19;
      color: #F3F4F6;
      margin: 0;
      padding: 32px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #1F2937;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    h1 { margin: 0; font-size: 22px; color: #FFFFFF; }
    .subtitle { color: #9CA3AF; font-size: 13px; margin-top: 4px; }
    .toolbar { display: flex; gap: 16px; align-items: center; }
    .btn-toggle {
      background: #1E293B;
      color: #38BDF8;
      border: 1px solid #38BDF8;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      transition: all 0.2s;
    }
    .btn-toggle:hover { background: #38BDF8; color: #0F172A; }
    .section-title {
      font-size: 18px;
      color: #FFFFFF;
      margin: 36px 0 16px 0;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid #1E293B;
      padding-bottom: 8px;
    }
    .section-desc {
      color: #94A3B8;
      font-size: 13px;
      margin-bottom: 16px;
      line-height: 1.5;
    }
    .event-card {
      background: #111827;
      border: 1px solid #1F2937;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 28px;
    }
    .event-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .event-title { font-size: 16px; font-weight: bold; color: #FFFFFF; }
    .event-tagline { font-size: 12px; color: #9CA3AF; margin-top: 2px; }
    .palette-swatches { display: flex; gap: 6px; align-items: center; }
    .swatch { width: 18px; height: 18px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); }
    .drafts-row {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      align-items: flex-start;
    }
    .card-cell {
      background: #0F172A;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 176px;
    }
    .svg-container {
      width: 156px;
      height: 247px;
      border-radius: 9px;
      overflow: hidden;
      box-shadow: 0 6px 18px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08);
      background: #000;
      transition: filter 0.3s ease;
    }
    .svg-container svg { width: 100%; height: 100%; display: block; }
    .card-meta {
      margin-top: 10px;
      font-size: 11px;
      color: #94A3B8;
      width: 100%;
      line-height: 1.4;
    }
    .card-meta div { display: flex; justify-content: space-between; margin-bottom: 2px; }
    .card-meta strong { color: #F1F5F9; }
    .badge-score {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 9999px;
      font-weight: bold;
      font-size: 11px;
    }
    .score-high { background: #064E3B; color: #6EE7B7; border: 1px solid #059669; }
    .score-mid { background: #78350F; color: #FCD34D; border: 1px solid #D97706; }
    .score-low { background: #7F1D1D; color: #FCA5A5; border: 1px solid #DC2626; }
    .chip-container { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .chip {
      background: #1E293B;
      color: #CBD5E1;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 9px;
    }
    .chip-fallback {
      background: #B45309;
      color: #FEF3C7;
      font-weight: bold;
    }

    /* Interactive Grayscale Mode */
    body.grayscale-active .svg-container {
      filter: grayscale(100%) contrast(1.1);
    }
    body.grayscale-active .btn-toggle {
      background: #38BDF8;
      color: #0F172A;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Event Design Composer (C2b Fix Round)</h1>
      <div class="subtitle">Palette-faithful composition • 3 distinct modes/archetypes • Role edge bars & grayscale lightness • Real-rendered ratio scorer</div>
    </div>
    <div class="toolbar">
      <button class="btn-toggle" onclick="toggleGrayscale()">Toggle Grayscale Mode</button>
    </div>
  </header>
`;

// ═══════════════════════════════════════════════════════════════════════
//  Section 1: 10 Events x 3 Seeds (30 composed drafts)
// ═══════════════════════════════════════════════════════════════════════
html += `<h2 class="section-title">1. Main Event Drafts (10 Events × 3 Distinct Drafts)</h2>
<div class="section-desc">Each event triplet guarantees 3 different archetypes, differing colour modes (light, dark, colour-field), and heading typography. Dominant colours derive faithfully from each event's palette.</div>`;

const globalPrngSeed = 1001;

for (let eIdx = 0; eIdx < showcaseEvents.length; eIdx++) {
  const ev = showcaseEvents[eIdx];
  const eventSpec = {
    ...sampleEventSpec,
    event: {
      ...sampleEventSpec.event,
      name: { value: ev.name, source: "user", confirmed: true },
      tagline: { value: ev.tagline, source: "user", confirmed: true },
      venue: { value: ev.venue, source: "user", confirmed: true },
      palette: ev.palette,
    },
  };

  const seed = globalPrngSeed + eIdx * 7;
  const draftResult = composeDrafts(eventSpec, {
    seed,
    font,
    fontRegistry,
    brand: activeBrandKit,
    count: 3,
  });

  html += `
  <div class="event-card">
    <div class="event-header">
      <div>
        <div class="event-title">${ev.name}</div>
        <div class="event-tagline">${ev.tagline} • ${ev.venue}</div>
      </div>
      <div class="palette-swatches">
        ${ev.palette.map((c) => `<div class="swatch" style="background:${c};" title="${c}"></div>`).join("")}
      </div>
    </div>
    <div class="drafts-row">
  `;

  for (let dIdx = 0; dIdx < draftResult.drafts.length; dIdx++) {
    const draft = draftResult.drafts[dIdx];
    const avatar = avatars[(eIdx * 3 + dIdx) % avatars.length];
    const typeKey = draft.look.attributes.typography;
    const activeFonts = fontRegistry[typeKey] || fontRegistry.default;

    const cardRender = renderCard({
      person: { ...personNormal, photo: avatar },
      event: eventSpec,
      brand: activeBrandKit,
      card: eventSpec.card,
      font,
      fonts: activeFonts,
      skeleton: draft.skeleton,
      blocks: draft.blocks,
      theme: draft.theme,
      look: draft.look,
    });

    const score = draft.scoreDetails;
    const scoreClass = score.total >= 80 ? "score-high" : score.total >= 60 ? "score-mid" : "score-low";
    const isFallback = draft.look.attributes.modeFallback || draft.modeFallback;

    html += `
      <div class="card-cell">
        <div class="svg-container">
          ${cardRender.svg}
        </div>
        <div class="card-meta">
          <div><span>Archetype:</span> <strong>${draft.archetype}</strong></div>
          <div><span>Mode:</span> <code>${draft.look.attributes.mode}</code></div>
          <div><span>Seed:</span> <code>${draft.seed}</code></div>
          <div><span>Quality Score:</span> <span class="badge-score ${scoreClass}">${score.total}/100</span></div>
          <div class="chip-container">
            <span class="chip" style="background:#1E3A8A;color:#93C5FD;">Type: ${activeFonts.label}</span>
            <span class="chip" title="Name to Role Ratio">R: ${score.nameToRoleRatio}x</span>
            <span class="chip" title="Empty Space Share">Space: ${Math.round(score.whitespaceShare * 100)}%</span>
            <span class="chip" title="Alignment Axes">Axes: ${score.alignmentAxes}</span>
            <span class="chip" title="Palette Usage">Pal: ${score.paletteColorsUsed}</span>
            ${isFallback ? `<span class="chip chip-fallback" title="Palette required mode fallback">fallback</span>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  html += `
    </div>
  </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════
//  Section 2: 5 Seeds for ONE Event Showcase (Condition B Proof)
// ═══════════════════════════════════════════════════════════════════════
html += `<h2 class="section-title">2. Single-Event Parameter Variation (5 Seeds for HackSurat 2026)</h2>
<div class="section-desc">Proof that different seeds genuinely vary parameters: header height, photo size/shape/position, mirrored layout, pill placement, mode, and typography.</div>`;

const singleEv = showcaseEvents[0];
const singleEventSpec = {
  ...sampleEventSpec,
  event: {
    ...sampleEventSpec.event,
    name: { value: singleEv.name, source: "user", confirmed: true },
    tagline: { value: singleEv.tagline, source: "user", confirmed: true },
    palette: singleEv.palette,
  },
};

const proofSeeds = [101, 202, 303, 404, 505];

html += `
<div class="event-card">
  <div class="event-header">
    <div class="event-title">HackSurat 2026 — 5 Seed Parameter Variations</div>
  </div>
  <div class="drafts-row">
`;

for (let sIdx = 0; sIdx < proofSeeds.length; sIdx++) {
  const s = proofSeeds[sIdx];
  const draftBundle = compose(singleEventSpec, s);
  const avatar = avatars[sIdx % avatars.length];
  const typeKey = draftBundle.look.attributes.typography;
  const activeFonts = fontRegistry[typeKey] || fontRegistry.default;

  const cardRender = renderCard({
    person: { ...personNormal, photo: avatar },
    event: singleEventSpec,
    brand: activeBrandKit,
    card: singleEventSpec.card,
    font,
    fonts: activeFonts,
    skeleton: draftBundle.skeleton,
    blocks: draftBundle.blocks,
    theme: draftBundle.theme,
    look: draftBundle.look,
  });

  const quality = scoreQuality(cardRender.scene, { card: singleEventSpec.card, palette: singleEv.palette, event: singleEventSpec });
  const scoreClass = quality.total >= 80 ? "score-high" : quality.total >= 60 ? "score-mid" : "score-low";

  html += `
    <div class="card-cell">
      <div class="svg-container">
        ${cardRender.svg}
      </div>
      <div class="card-meta">
        <div><span>Archetype:</span> <strong>${draftBundle.archetype}</strong></div>
        <div><span>Mode:</span> <code>${draftBundle.look.attributes.mode}</code></div>
        <div><span>Seed:</span> <code>${s}</code></div>
        <div><span>Score:</span> <span class="badge-score ${scoreClass}">${quality.total}/100</span></div>
        <div class="chip-container">
          <span class="chip" style="background:#1E3A8A;color:#93C5FD;">Type: ${activeFonts.label}</span>
          <span class="chip">Photo: ${draftBundle.look.attributes.photo}</span>
          <span class="chip">Header: ${draftBundle.look.attributes.header}</span>
        </div>
      </div>
    </div>
  `;
}

html += `
  </div>
</div>
`;

// ═══════════════════════════════════════════════════════════════════════
//  Section 3: Role Variations (Volunteer, Participant, Organizer, Mentor)
// ═══════════════════════════════════════════════════════════════════════
html += `<h2 class="section-title">3. Role Differentiation & Grayscale Lightness (4 Lightness Steps)</h2>
<div class="section-desc">Default role colours have 4 lightness steps >= 15% apart. Roles also have a role-coloured edge bar (>= 3mm). Click "Toggle Grayscale Mode" above to verify clear contrast in black & white.</div>`;

const roleCardsEv = showcaseEvents[0];
const rolesShowcase = [
  { id: "volunteer", label: "VOLUNTEER", color: DEFAULT_ROLE_COLORS.volunteer, lightness: "86%" },
  { id: "participant", label: "PARTICIPANT", color: DEFAULT_ROLE_COLORS.participant, lightness: "68%" },
  { id: "organizer", label: "ORGANIZER", color: DEFAULT_ROLE_COLORS.organizer, lightness: "44%" },
  { id: "mentor", label: "MENTOR", color: DEFAULT_ROLE_COLORS.mentor, lightness: "17%" },
];

html += `
<div class="event-card">
  <div class="event-header">
    <div class="event-title">Role Matrix with Edge Bars & Lightness Separation</div>
  </div>
  <div class="drafts-row">
`;

const sampleDraft = compose(singleEventSpec, 999, "hero-photo-top");

for (let rIdx = 0; rIdx < rolesShowcase.length; rIdx++) {
  const r = rolesShowcase[rIdx];
  const avatar = avatars[rIdx % avatars.length];

  const roleEventSpec = {
    ...singleEventSpec,
    roles: [{ id: r.id, label: r.label, expectedCount: 20, color: { value: r.color } }],
  };

  const cardRender = renderCard({
    person: { ...personNormal, roleId: r.id, photo: avatar },
    event: roleEventSpec,
    brand: activeBrandKit,
    card: roleEventSpec.card,
    font,
    skeleton: sampleDraft.skeleton,
    blocks: sampleDraft.blocks,
    theme: sampleDraft.theme,
    look: sampleDraft.look,
  });

  html += `
    <div class="card-cell">
      <div class="svg-container">
        ${cardRender.svg}
      </div>
      <div class="card-meta">
        <div><span>Role:</span> <strong>${r.label}</strong></div>
        <div><span>Lightness:</span> <code>${r.lightness} L</code></div>
        <div><span>Pill / Bar:</span> <span style="display:inline-block;width:12px;height:12px;background:${r.color};border-radius:2px;vertical-align:middle;"></span> <code>${r.color}</code></div>
      </div>
    </div>
  `;
}

html += `
  </div>
</div>
`;

// ═══════════════════════════════════════════════════════════════════════
//  Section 4: Stress & Edge Cases Showcase
// ═══════════════════════════════════════════════════════════════════════
html += `<h2 class="section-title">4. Edge Cases Showcase (No Photo, Missing Org, Missing ID, Long Name)</h2>
<div class="section-desc">Priority when space is tight: drop QR first, then org, then ID line. Missing values cleanly hide with no layout gaps.</div>`;

const edgeDraft = compose(singleEventSpec, 777, "typographic-name-first");

// Case 1: No Photo
const renderNoPhoto = renderCard({
  person: { ...personNormal, photo: null },
  event: singleEventSpec,
  brand: activeBrandKit,
  card: singleEventSpec.card,
  font,
  skeleton: edgeDraft.skeleton,
  blocks: edgeDraft.blocks,
  theme: edgeDraft.theme,
  look: edgeDraft.look,
});

// Case 2: Missing Org
const renderNoOrg = renderCard({
  person: { ...personNormal, org: undefined, photo: avatars[0] },
  event: singleEventSpec,
  brand: activeBrandKit,
  card: singleEventSpec.card,
  font,
  skeleton: edgeDraft.skeleton,
  blocks: edgeDraft.blocks,
  theme: edgeDraft.theme,
  look: edgeDraft.look,
});

// Case 3: Missing ID
const renderNoId = renderCard({
  person: { ...personNormal, id: "", photo: avatars[1] },
  event: singleEventSpec,
  brand: activeBrandKit,
  card: singleEventSpec.card,
  font,
  skeleton: edgeDraft.skeleton,
  blocks: edgeDraft.blocks,
  theme: edgeDraft.theme,
  look: edgeDraft.look,
});

// Case 4: 57-char long name
const renderLongName = renderCard({
  person: personLongName,
  event: singleEventSpec,
  brand: activeBrandKit,
  card: singleEventSpec.card,
  font,
  skeleton: edgeDraft.skeleton,
  blocks: edgeDraft.blocks,
  theme: edgeDraft.theme,
  look: edgeDraft.look,
});

html += `
<div class="event-card">
  <div class="event-header">
    <div class="event-title">Dynamic Handling of Missing Fields & Long Names</div>
  </div>
  <div class="drafts-row">
    <div class="card-cell">
      <div class="svg-container">${renderNoPhoto.svg}</div>
      <div class="card-meta">
        <div><span>Case:</span> <strong>No Photo</strong></div>
        <div><span>Behavior:</span> Silhouette / Initials</div>
      </div>
    </div>
    <div class="card-cell">
      <div class="svg-container">${renderNoOrg.svg}</div>
      <div class="card-meta">
        <div><span>Case:</span> <strong>Missing Org</strong></div>
        <div><span>Behavior:</span> Closes gap cleanly</div>
      </div>
    </div>
    <div class="card-cell">
      <div class="svg-container">${renderNoId.svg}</div>
      <div class="card-meta">
        <div><span>Case:</span> <strong>Missing ID</strong></div>
        <div><span>Behavior:</span> Optional field hidden</div>
      </div>
    </div>
    <div class="card-cell">
      <div class="svg-container">${renderLongName.svg}</div>
      <div class="card-meta">
        <div><span>Case:</span> <strong>57-Char Long Name</strong></div>
        <div><span>Behavior:</span> Scaled to floor & fits</div>
      </div>
    </div>
  </div>
</div>
`;

// ═══════════════════════════════════════════════════════════════════════
//  Section 5: Shared Logo Plate (Before vs After) & QR Placeholder
// ═══════════════════════════════════════════════════════════════════════
html += `<h2 class="section-title">5. Logo Plate Redesign & QR Placeholder (Round C2c)</h2>
<div class="section-desc">Replaced separate white boxes with ONE shared white rounded plate (1mm padding, 1.5mm radius) spanning both logos. On near-white backgrounds, no plate is drawn. QR is rendered as a clean placeholder box without external dependencies.</div>`;

const plateDraft = compose(singleEventSpec, 101, "hero-photo-top", "colour-field");

// Before: separate plates (plate: "auto")
const beforeBlocks = JSON.parse(JSON.stringify(plateDraft.blocks));
for (const b of Object.values(beforeBlocks)) {
  if (b.elements) {
    for (const el of b.elements) {
      if (el.plate === "shared") el.plate = "auto";
    }
  }
}
const renderBeforePlate = renderCard({
  person: { ...personNormal, photo: avatars[0] },
  event: { ...singleEventSpec, event: { ...singleEventSpec.event, palette: showcaseEvents[0].palette } },
  brand: activeBrandKit,
  card: singleEventSpec.card,
  font,
  skeleton: plateDraft.skeleton,
  blocks: beforeBlocks,
  theme: plateDraft.theme,
  look: plateDraft.look,
});

// After: one shared plate (plate: "shared")
const renderAfterPlate = renderCard({
  person: { ...personNormal, photo: avatars[0] },
  event: { ...singleEventSpec, event: { ...singleEventSpec.event, palette: showcaseEvents[0].palette } },
  brand: activeBrandKit,
  card: singleEventSpec.card,
  font,
  skeleton: plateDraft.skeleton,
  blocks: plateDraft.blocks,
  theme: plateDraft.theme,
  look: plateDraft.look,
});

// After on Light Background (no plate drawn)
const lightDraft = compose(showcaseEvents[0], 102, "hero-photo-top", "light");
const renderLightPlate = renderCard({
  person: { ...personNormal, photo: avatars[1] },
  event: { ...singleEventSpec, event: { ...singleEventSpec.event, palette: showcaseEvents[0].palette } },
  brand: activeBrandKit,
  card: singleEventSpec.card,
  font,
  skeleton: lightDraft.skeleton,
  blocks: lightDraft.blocks,
  theme: lightDraft.theme,
  look: lightDraft.look,
});

html += `
<div class="event-card">
  <div class="event-header">
    <div class="event-title">Shared Logo Plate Comparison & QR Box</div>
  </div>
  <div class="drafts-row">
    <div class="card-cell">
      <div class="svg-container">${renderBeforePlate.svg}</div>
      <div class="card-meta">
        <div><span>State:</span> <strong>BEFORE (C2b)</strong></div>
        <div><span>Plates:</span> 2 separate boxes</div>
        <div class="chip-container"><span class="chip">plate: auto</span></div>
      </div>
    </div>
    <div class="card-cell">
      <div class="svg-container">${renderAfterPlate.svg}</div>
      <div class="card-meta">
        <div><span>State:</span> <strong>AFTER (C2c)</strong></div>
        <div><span>Plates:</span> 1 shared rounded plate</div>
        <div class="chip-container"><span class="chip" style="background:#065F46;color:#A7F3D0;">plate: shared</span><span class="chip">padding: 1mm</span></div>
      </div>
    </div>
    <div class="card-cell">
      <div class="svg-container">${renderLightPlate.svg}</div>
      <div class="card-meta">
        <div><span>State:</span> <strong>LIGHT BACKGROUND</strong></div>
        <div><span>Plates:</span> No plate needed</div>
        <div class="chip-container"><span class="chip">L &ge; 0.88</span></div>
      </div>
    </div>
  </div>
</div>
`;

html += `
  <script>
    function toggleGrayscale() {
      document.body.classList.toggle('grayscale-active');
    }
  </script>
</body>
</html>`;

const outPath = resolve(process.cwd(), "drafts.html");
writeFileSync(outPath, html, "utf8");
console.log(`Spike gallery generated successfully: drafts.html`);
