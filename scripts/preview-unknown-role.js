// @ts-check
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import { renderCard, compose, validate } from "../core/index.js";
import { sampleBrandKit, sampleEventSpec } from "../core/fixtures.js";

// Load fonts
function loadFont(relPath) {
  const p = resolve(process.cwd(), relPath);
  const buf = readFileSync(p);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const fonts = {
  heading: loadFont("assets/fonts/SpaceGrotesk-Bold.ttf"),
  body: loadFont("assets/fonts/Inter-Regular.ttf"),
};

// Compose a design template
const design = compose(sampleEventSpec, "unknown-role-demo-seed", "hero-photo-top");

// Person with an unknown roleId "boss"
const badPerson = {
  id: "HX26-DEMO-001",
  name: "Alexander Boss",
  roleId: "boss", // Not in sampleEventSpec.roles!
  org: "Executive Leadership",
  email: "boss@example.com",
  photo: null,
  flags: [],
};

console.log("=== Rendering Card with Unresolved Role: 'boss' ===");
console.log("Person:", badPerson);
console.log("Known Event Roles:", sampleEventSpec.roles.map((r) => r.id));

const result = renderCard({
  skeleton: design.skeleton,
  blocks: design.blocks,
  theme: design.theme,
  look: design.look,
  event: sampleEventSpec,
  brand: sampleBrandKit,
  person: badPerson,
  fonts,
});

// Inspect the role node in the scene
const roleNode = result.scene.find((n) => n.id === "role");
const roleBarNode = result.scene.find((n) => n.id === "roleMarker" || n.id === "bar");

console.log("\n=== Render Output Inspection ===");
console.log("Role Label in Scene:", roleNode?.lines ? roleNode.lines.join(" ") : "(not found)");
console.log("Role Bar Fill:", roleBarNode?.fill || "(not found)");
console.log("Render Issues Count:", result.issues.length);
console.log("Render Issues:", JSON.stringify(result.issues, null, 2));

// HTML preview output
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Task R1: Unknown Role Preview</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0B0F19;
      color: #F3F4F6;
      margin: 0;
      padding: 40px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    h1 { margin: 0 0 8px 0; font-size: 24px; color: #FFFFFF; }
    p.sub { color: #94A3B8; margin: 0 0 32px 0; font-size: 14px; }
    .container {
      display: flex;
      gap: 32px;
      background: #111827;
      border: 1px solid #1F2937;
      border-radius: 12px;
      padding: 24px;
      max-width: 800px;
    }
    .card-box {
      width: 216px;
      height: 342px;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      background: #000;
    }
    .card-box svg { width: 100%; height: 100%; display: block; }
    .details { flex: 1; }
    .badge-error {
      background: #EF4444;
      color: #FFFFFF;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: bold;
    }
    .issue-card {
      background: #1F2937;
      border-left: 4px solid #EF4444;
      padding: 12px;
      border-radius: 4px;
      margin-top: 12px;
      font-size: 13px;
    }
    code { background: #374151; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Task R1: Unknown Role Handling</h1>
  <p class="sub">Person roleId: <code>"boss"</code> is not defined in event.roles. Notice the neutral grey <code>UNKNOWN ROLE</code> pill and the blocking validator error.</p>

  <div class="container">
    <div class="card-box">
      ${result.svg}
    </div>
    <div class="details">
      <h3>Validation Gate Status: <span class="badge-error">BLOCKS EXPORT (D-09)</span></h3>
      <p>Total issues: <strong>${result.issues.length}</strong> (Errors: ${result.issues.filter((i) => i.severity === "error").length})</p>

      <h4>Issues Reported:</h4>
      ${result.issues
        .map(
          (iss) => `
        <div class="issue-card">
          <div><strong style="color:#F87171;">[${iss.severity.toUpperCase()}] ${iss.code}</strong></div>
          <div style="margin-top:4px;">${iss.message}</div>
        </div>
      `
        )
        .join("")}
    </div>
  </div>
</body>
</html>
`;

writeFileSync(resolve(process.cwd(), "unknown-role-preview.html"), html, "utf-8");
console.log("\nWrote HTML preview to unknown-role-preview.html successfully!");
