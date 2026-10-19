// @ts-check
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import {
  parseExportSettings,
  sheetLayout,
  renderCard,
  compose,
} from "../core/index.js";
import { sampleBrandKit, sampleEventSpec } from "../core/fixtures.js";
import { loadContent } from "./loadContent.js";

// Check CLI flags for badges
const hideBadgesCli =
  process.argv.includes("--no-badges") ||
  process.argv.includes("--badges=0") ||
  process.argv.includes("badges=0");

// Load fonts for renderCard
function loadFont(relPath) {
  const p = resolve(process.cwd(), relPath);
  const buf = readFileSync(p);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const fonts = {
  heading: loadFont("assets/fonts/SpaceGrotesk-Bold.ttf"),
  body: loadFont("assets/fonts/Inter-Regular.ttf"),
};

// Load content
const { brandKits } = loadContent();
const brandKit = brandKits["test-logos"] || brandKits["acm-nitsurat"] || sampleBrandKit;

// 20 sample cards across two roles
const samplePeople = [
  // 8 Organizers
  { id: "HX26-ORG-001", name: "Aarav Mehta", org: "ACM Core Team", role: "Organizer", roleId: "organizer" },
  { id: "HX26-ORG-002", name: "Ananya Sharma", org: "Logistics Lead", role: "Organizer", roleId: "organizer" },
  { id: "HX26-ORG-003", name: "Rohan Patel", org: "Technical Operations", role: "Organizer", roleId: "organizer" },
  { id: "HX26-ORG-004", name: "Diya Iyer", org: "Design Team", role: "Organizer", roleId: "organizer" },
  { id: "HX26-ORG-005", name: "Kabir Verma", org: "Sponsorship Lead", role: "Organizer", roleId: "organizer" },
  { id: "HX26-ORG-006", name: "Meera Nair", org: "Public Relations", role: "Organizer", roleId: "organizer" },
  { id: "HX26-ORG-007", name: "Vikram Joshi", org: "Web Infrastructure", role: "Organizer", roleId: "organizer" },
  { id: "HX26-ORG-008", name: "Pooja Reddy", org: "Volunteer Coordination", role: "Organizer", roleId: "organizer" },

  // 12 Participants
  { id: "HX26-PAR-001", name: "Ishaan Malhotra", org: "IIT Bombay", role: "Participant", roleId: "participant" },
  { id: "HX26-PAR-002", name: "Rajeshwari Venkat", org: "NIT Surat", role: "Participant", roleId: "participant" },
  { id: "HX26-PAR-003", name: "Tanvi Deshmukh", org: "BITS Pilani", role: "Participant", roleId: "participant" },
  { id: "HX26-PAR-004", name: "Aditya Kulkarni", org: "COEP Pune", role: "Participant", roleId: "participant" },
  { id: "HX26-PAR-005", name: "Sneha Mukherjee", org: "Jadavpur University", role: "Participant", roleId: "participant" },
  { id: "HX26-PAR-006", name: "Karthik Raja", org: "NIT Trichy", role: "Participant", roleId: "participant" },
  { id: "HX26-PAR-007", name: "Bhavna Bhatt", org: "DAIICT", role: "Participant", roleId: "participant" },
  { id: "HX26-PAR-008", name: "Devansh Saxena", org: "IIIT Hyderabad", role: "Participant", roleId: "participant" },
  { id: "HX26-PAR-009", name: "Rhea Sen", org: "Delhi University", role: "Participant", roleId: "participant" },
  { id: "HX26-PAR-010", name: "Arjun Nambiar", org: "NIT Calicut", role: "Participant", roleId: "participant" },
  { id: "HX26-PAR-011", name: "Kavya Menon", org: "Amrita University", role: "Participant", roleId: "participant" },
  { id: "HX26-PAR-012", name: "Siddharth Jain", org: "VJTI Mumbai", role: "Participant", roleId: "participant" },
];

// Event definition including roles with designated labels and theme colors
const eventSpecWithRoles = {
  ...sampleEventSpec,
  roles: [
    {
      id: "organizer",
      label: "ORGANIZER",
      expectedCount: 20,
      color: { value: "#D97706", status: "provided", source: "brief" },
    },
    {
      id: "participant",
      label: "PARTICIPANT",
      expectedCount: 200,
      color: { value: "#2563EB", status: "defaulted", source: "default" },
    },
    {
      id: "mentor",
      label: "MENTOR",
      expectedCount: 20,
      color: { value: "#16A34A", status: "defaulted", source: "default" },
    },
  ],
};

const cards = samplePeople.map((p) => ({ id: p.id, role: p.roleId }));

// Export settings with standard defaults (A4, portrait CR80, 5mm margin, 4mm gap)
const settings = parseExportSettings({
  format: "pdf",
  mode: "sheets",
  orientation: "portrait",
  card: { widthMm: 54, heightMm: 85.6 },
  bleedMm: 3,
  cropMarks: true,
  sheet: {
    paper: "A4",
    marginMm: 5,
    gapMm: 4,
    markLengthMm: 2,
    markOffsetMm: 3,
    markStrokeMm: 0.35,
  },
});

console.log("Generating print-sheet layout with settings:", {
  paper: settings.sheet.paper,
  sheetSize: `${settings.sheet.widthMm}x${settings.sheet.heightMm}mm`,
  cardSize: `${settings.card.widthMm}x${settings.card.heightMm}mm`,
  bleed: `${settings.bleedMm}mm`,
  margin: `${settings.sheet.marginMm}mm`,
  gap: `${settings.sheet.gapMm}mm`,
});

const layout = sheetLayout(settings, cards);

console.log(`Grid calculation: ${layout.cols} cols x ${layout.rows} rows = ${layout.perPage} cards/page.`);
console.log(`Total cards: ${cards.length} placed across ${layout.pages.length} page(s).`);

if (layout.warnings.length > 0) {
  console.warn("Layout warnings:", layout.warnings);
}

// Generate Page 1 SVG
const page1 = layout.pages[0];

// Prepare design template using compose
const designBundle = compose(sampleEventSpec, 101);

/**
 * Renders individual card SVGs inside cells
 */
let renderedCardsSvg = "";
for (let i = 0; i < page1.cells.length; i++) {
  const cell = page1.cells[i];
  const person = samplePeople.find((p) => p.id === cell.cardId) || {
    id: cell.cardId,
    name: "Sample Person",
    org: "ACM NIT Surat",
    role: "Participant",
    roleId: "participant",
  };

  const { svg, scene } = renderCard({
    skeleton: designBundle.skeleton,
    blocks: designBundle.blocks,
    theme: designBundle.theme,
    look: designBundle.look,
    event: eventSpecWithRoles,
    brand: brandKit,
    person,
    fonts,
  });

  // Strict check: confirm that the rendered label on every card equals its role
  const roleNode = scene.find((n) => n.id === "role");
  const actualRoleLabel = roleNode ? roleNode.lines.join(" ").toUpperCase() : "";
  const expectedRoleLabel = person.role.toUpperCase();
  if (actualRoleLabel !== expectedRoleLabel) {
    throw new Error(
      `Role assertion failed for card ${cell.cardId}: expected label "${expectedRoleLabel}", got "${actualRoleLabel}"`
    );
  }
  if (!svg.includes(`aria-label="${expectedRoleLabel}"`)) {
    throw new Error(
      `Role SVG aria-label assertion failed for card ${cell.cardId}: SVG does not contain aria-label="${expectedRoleLabel}"`
    );
  }

  // Extract inner SVG content (strip outer <svg> and </svg> tags)
  const innerContent = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");

  // Use PLAIN NUMBERS without "mm" units for all nested card <svg> attributes!
  // In an SVG with viewBox="0 0 210 297", 1 user unit = 1 mm.
  // Adding "mm" causes SVG engines to scale by 3.7795 px/mm (making cards 3.8x too big).
  renderedCardsSvg += `
    <!-- Card Cell ${i + 1}: ${cell.cardId} (${person.role}) -->
    <g id="cell-${cell.cardId}" class="card-cell">
      <!-- Overlay: Bleed Box (Cyan dashed line, 60x91.6mm) -->
      <rect x="${cell.bleedBox.x}" y="${cell.bleedBox.y}" width="${cell.bleedBox.w}" height="${cell.bleedBox.h}"
            fill="none" stroke="#0284C7" stroke-width="0.3" stroke-dasharray="3,3" class="bleed-outline"/>

      <!-- Overlay: Trim Box (Green dashed line, 54x85.6mm) -->
      <rect x="${cell.trimBox.x}" y="${cell.trimBox.y}" width="${cell.trimBox.w}" height="${cell.trimBox.h}"
            fill="none" stroke="#16A34A" stroke-width="0.35" stroke-dasharray="2,2" class="trim-outline"/>

      <!-- Embedded Card SVG: positioned at trimBox with plain numbers (NO 'mm') -->
      <svg x="${cell.trimBox.x}" y="${cell.trimBox.y}" width="${cell.trimBox.w}" height="${cell.trimBox.h}" viewBox="0 0 ${cell.trimBox.w} ${cell.trimBox.h}">
        ${innerContent}
      </svg>

      <!-- Card ID Badge (Togglable via UI checkbox, ?badges=0, or --no-badges flag) -->
      <g id="badge-${cell.cardId}" class="card-id-badge" transform="translate(${cell.trimBox.x + 3}, ${cell.trimBox.y + cell.trimBox.h - 4})" ${hideBadgesCli ? 'style="display:none;"' : ''}>
        <rect x="0" y="-7" width="38" height="8" rx="2" fill="#0F172A" opacity="0.9" stroke="#FFFFFF" stroke-width="0.4"/>
        <text x="3" y="-1.5" font-family="monospace" font-size="4.2" font-weight="bold" fill="#FFFFFF">${cell.cardId}</text>
      </g>
    </g>
  `;
}

// Generate vector crop marks lines
let marksSvg = "";
for (let i = 0; i < page1.marks.length; i++) {
  const m = page1.marks[i];
  marksSvg += `  <line x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}" stroke="#0F172A" stroke-width="${m.strokeMm}" class="crop-mark"/>\n`;
}

// Full A4 sheet SVG (outer sheet uses mm for physical print size + 0 0 210 297 viewBox)
const sheetSvg = `
<svg xmlns="http://www.w3.org/2000/svg"
     width="${settings.sheet.widthMm}mm" height="${settings.sheet.heightMm}mm"
     viewBox="0 0 ${settings.sheet.widthMm} ${settings.sheet.heightMm}"
     id="sheet-svg"
     style="background: #FFFFFF; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); border-radius: 4px;">
  
  <!-- Sheet Background -->
  <rect width="${settings.sheet.widthMm}" height="${settings.sheet.heightMm}" fill="#FFFFFF"/>

  <!-- Page Margin Guide Line (5mm boundary) -->
  <rect x="${settings.sheet.marginMm}" y="${settings.sheet.marginMm}"
        width="${settings.sheet.widthMm - 2 * settings.sheet.marginMm}"
        height="${settings.sheet.heightMm - 2 * settings.sheet.marginMm}"
        fill="none" stroke="#CBD5E1" stroke-width="0.4" stroke-dasharray="4,4" class="margin-outline"/>

  <!-- Rendered Cards -->
  <g id="cards-layer">
    ${renderedCardsSvg}
  </g>

  <!-- Vector Crop Marks -->
  <g id="crop-marks-layer">
    ${marksSvg}
  </g>

  <!-- Sheet Border (Sheet edge 210 x 297 mm) -->
  <rect x="0" y="0" width="${settings.sheet.widthMm}" height="${settings.sheet.heightMm}"
        fill="none" stroke="#94A3B8" stroke-width="0.5"/>
</svg>
`.trim();

// ═══════════════════════════════════════════════════════════════════════
// Strict Assertion: Ensure no nested card <svg> contains "mm" units
// ═══════════════════════════════════════════════════════════════════════
const nestedSvgMatches = sheetSvg.match(/<svg\b[^>]*>/g) || [];
if (nestedSvgMatches.length <= 1) {
  throw new Error("Assertion failed: No nested card <svg> elements found in output");
}

for (let i = 1; i < nestedSvgMatches.length; i++) {
  const svgTag = nestedSvgMatches[i];
  if (/\b(x|y|width|height|viewBox)\s*=\s*"[^"]*mm/i.test(svgTag)) {
    throw new Error(`Assertion failed: Nested card <svg> contains 'mm' units in attributes: ${svgTag}`);
  }
}
console.log(`Assertion PASSED: All ${nestedSvgMatches.length - 1} nested card <svg> elements use plain numbers without 'mm' units.`);

// HTML Preview container with interactive badge and outline controls
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Print-Sheet Imposition Preview (Task E1)</title>
  <style>
    body {
      margin: 0;
      padding: 30px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0F172A;
      color: #F8FAFC;
    }
    .header {
      max-width: 1200px;
      margin: 0 auto 20px auto;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1px solid #334155;
      padding-bottom: 16px;
    }
    h1 { margin: 0 0 6px 0; font-size: 22px; color: #38BDF8; }
    p { margin: 0; font-size: 13px; color: #94A3B8; }
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      background: #0284C7;
      color: #FFFFFF;
      margin-left: 6px;
    }
    .toolbar {
      max-width: 1200px;
      margin: 0 auto 20px auto;
      display: flex;
      align-items: center;
      gap: 16px;
      background: #1E293B;
      padding: 10px 18px;
      border-radius: 8px;
      border: 1px solid #334155;
      font-size: 13px;
    }
    .toolbar label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
    }
    .toolbar input[type="checkbox"] {
      cursor: pointer;
      accent-color: #0284C7;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      max-width: 1200px;
      margin: 0 auto 20px auto;
    }
    .stat-card {
      background: #1E293B;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 12px 14px;
    }
    .stat-label { font-size: 11px; text-transform: uppercase; color: #64748B; font-weight: bold; }
    .stat-val { font-size: 17px; font-weight: 700; color: #F1F5F9; margin-top: 3px; font-family: monospace; }
    .stat-sub { font-size: 11px; color: #38BDF8; margin-top: 2px; }

    .main-view {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      gap: 30px;
      align-items: flex-start;
    }
    .sheet-container {
      flex: 0 0 auto;
      background: #090D16;
      padding: 24px;
      border-radius: 12px;
      border: 1px solid #334155;
      overflow: auto;
      display: flex;
      justify-content: center;
    }
    .sidebar {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .panel {
      background: #1E293B;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 16px;
    }
    .panel h2 {
      margin: 0 0 10px 0;
      font-size: 15px;
      color: #38BDF8;
      border-bottom: 1px solid #334155;
      padding-bottom: 6px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .legend-line {
      width: 24px;
      height: 0px;
      border-bottom: 2px solid;
    }
    .cards-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
    }
    .cards-table th, .cards-table td {
      padding: 5px 8px;
      text-align: left;
      border-bottom: 1px solid #334155;
    }
    .cards-table th { color: #64748B; font-weight: 600; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Print-Sheet Imposition Preview <span class="badge">Task E1 Pure Math</span></h1>
      <p>True millimeter-scale A4 sheet (210 x 297 mm) with portrait CR80 cards (54 x 85.6 mm), 3 mm bleed, and vector crop marks.</p>
    </div>
    <div>
      <span class="badge" style="background: #16A34A;">9 Cards on Page 1</span>
      <span class="badge" style="background: #7C3AED;">20 Cards Total (3 Pages)</span>
    </div>
  </div>

  <div class="toolbar">
    <span style="font-weight: 600; color: #94A3B8; margin-right: 8px;">View Controls:</span>
    <label>
      <input type="checkbox" id="toggle-badges" ${hideBadgesCli ? "" : "checked"}>
      <span>Show Card ID Badges (or append <code>?badges=0</code>)</span>
    </label>
    <label>
      <input type="checkbox" id="toggle-trim" checked>
      <span>Green Trim Lines (54 x 85.6 mm)</span>
    </label>
    <label>
      <input type="checkbox" id="toggle-bleed" checked>
      <span>Cyan Bleed Boxes (60 x 91.6 mm)</span>
    </label>
    <label>
      <input type="checkbox" id="toggle-marks" checked>
      <span>Crop Marks</span>
    </label>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Sheet Dimensions</div>
      <div class="stat-val">${settings.sheet.widthMm} x ${settings.sheet.heightMm} mm</div>
      <div class="stat-sub">Paper: ${settings.sheet.paper} (Portrait)</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Grid Layout</div>
      <div class="stat-val">${layout.cols} cols x ${layout.rows} rows</div>
      <div class="stat-sub">Yield: ${layout.perPage} cards / sheet</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Card Size (Trim)</div>
      <div class="stat-val">${settings.card.widthMm} x ${settings.card.heightMm} mm</div>
      <div class="stat-sub">Bleed: +${settings.bleedMm}mm (${settings.card.widthMm + 2 * settings.bleedMm} x ${settings.card.heightMm + 2 * settings.bleedMm}mm cell)</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Margins & Gap</div>
      <div class="stat-val">X: 11.0mm | Y: 7.1mm</div>
      <div class="stat-sub">Gap between cells: ${settings.sheet.gapMm} mm</div>
    </div>
  </div>

  <div class="main-view">
    <div class="sheet-container">
      ${sheetSvg}
    </div>

    <div class="sidebar">
      <div class="panel">
        <h2>Visual Layer Legend</h2>
        <div class="legend-item">
          <div class="legend-line" style="border-color: #16A34A; border-style: dashed;"></div>
          <span><strong>Card Trim Box</strong> (54.0 x 85.6 mm) &mdash; Finished physical card edge</span>
        </div>
        <div class="legend-item">
          <div class="legend-line" style="border-color: #0284C7; border-style: dashed;"></div>
          <span><strong>Bleed Box</strong> (60.0 x 91.6 mm) &mdash; 3 mm outer bleed for cutting tolerances</span>
        </div>
        <div class="legend-item">
          <div class="legend-line" style="border-color: #0F172A; border-width: 3px;"></div>
          <span><strong>Vector Crop Marks</strong> &mdash; 0.35 mm stroke, 2 mm length, sits outside bleed</span>
        </div>
        <div class="legend-item">
          <div class="legend-line" style="border-color: #CBD5E1; border-style: dashed;"></div>
          <span><strong>Page Margin</strong> (5.0 mm nominal) &mdash; All cards & marks stay within bounds</span>
        </div>
      </div>

      <div class="panel">
        <h2>Page 1 Cell Roster (9 Cards)</h2>
        <table class="cards-table">
          <thead>
            <tr>
              <th>Cell</th>
              <th>Card ID</th>
              <th>Participant</th>
              <th>Role</th>
              <th>Trim X, Y (mm)</th>
            </tr>
          </thead>
          <tbody>
            ${page1.cells
              .map((c, idx) => {
                const person = samplePeople.find((p) => p.id === c.cardId) || { name: "", role: "" };
                return `<tr>
                  <td><strong>#${idx + 1}</strong></td>
                  <td><code>${c.cardId}</code></td>
                  <td>${person.name}</td>
                  <td>${person.role}</td>
                  <td><code>${c.xMm.toFixed(1)}, ${c.yMm.toFixed(1)}</code></td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>

      <div class="panel">
        <h2>Mathematical Verification</h2>
        <ul style="font-size: 12.5px; line-height: 1.5; padding-left: 18px; margin: 0; color: #CBD5E1;">
          <li><strong>Width Arithmetic</strong>: 3 cols &times; 60mm + 2 gaps &times; 4mm = 188.0mm. Sheet width = 210mm. Margin X = (210 - 188) / 2 = <strong>11.0mm</strong> (&ge; 5.0mm nominal).</li>
          <li><strong>Height Arithmetic</strong>: 3 rows &times; 91.6mm + 2 gaps &times; 4mm = 282.8mm. Sheet height = 297mm. Margin Y = (297 - 282.8) / 2 = <strong>7.1mm</strong> (&ge; 5.0mm nominal).</li>
          <li><strong>Crop Mark Clearance</strong>: Mark offset = 3mm (= bleed), length = 2mm. Distance between adjacent trims = 2 &times; 3 + 4 = 10mm. Mark reaches = 3+2 + 3+2 = 10mm. Marks meet at center with <strong>0 collision into any bleed or trim box</strong>.</li>
        </ul>
      </div>
    </div>
  </div>

  <script>
    // Interactive toggles
    const badgeToggle = document.getElementById("toggle-badges");
    const trimToggle = document.getElementById("toggle-trim");
    const bleedToggle = document.getElementById("toggle-bleed");
    const marksToggle = document.getElementById("toggle-marks");

    const badges = document.querySelectorAll(".card-id-badge");
    const trimLines = document.querySelectorAll(".trim-outline");
    const bleedLines = document.querySelectorAll(".bleed-outline");
    const marksGroup = document.getElementById("crop-marks-layer");

    function setBadgesVisible(visible) {
      badges.forEach(b => b.style.display = visible ? "" : "none");
      if (badgeToggle) badgeToggle.checked = visible;
    }

    // Check URL params (?badges=0 or ?badges=false or ?nobadges)
    const params = new URLSearchParams(window.location.search);
    if (params.get("badges") === "0" || params.get("badges") === "false" || params.has("nobadges")) {
      setBadgesVisible(false);
    }

    if (badgeToggle) {
      badgeToggle.addEventListener("change", (e) => setBadgesVisible(e.target.checked));
    }
    if (trimToggle) {
      trimToggle.addEventListener("change", (e) => {
        trimLines.forEach(l => l.style.display = e.target.checked ? "" : "none");
      });
    }
    if (bleedToggle) {
      bleedToggle.addEventListener("change", (e) => {
        bleedLines.forEach(l => l.style.display = e.target.checked ? "" : "none");
      });
    }
    if (marksToggle) {
      marksToggle.addEventListener("change", (e) => {
        if (marksGroup) marksGroup.style.display = e.target.checked ? "" : "none";
      });
    }
  </script>
</body>
</html>
`;

writeFileSync(resolve(process.cwd(), "sheet-preview.html"), html, "utf-8");
console.log("Wrote sheet-preview.html successfully with unitless nested SVGs and interactive badge toggle!");
