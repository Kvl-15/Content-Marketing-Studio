// @ts-check
import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import {
  exportCard,
  exportSheet,
  exportZip,
  qrPath,
  inspectPdfBytes,
} from "../server/export/index.js";
import { sampleEventSpec } from "../core/fixtures.js";
import { composeDrafts } from "../core/composer.js";
import { loadContent } from "./loadContent.js";

// Load fonts using opentype.parse for text outline rendering (Rule D-28)
function loadFont(relPath) {
  const fullPath = path.resolve(process.cwd(), relPath);
  const buf = fs.readFileSync(fullPath);
  return opentype.parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
}

async function main() {
  console.log(
    "================================================================="
  );
  console.log(
    "=== ACM Content Marketing Studio: Print Sheet & Batch Export Demo (E2b) ==="
  );
  console.log(
    "=================================================================\n"
  );

  const exportDir = path.resolve(process.cwd(), "exports");
  await fs.promises.mkdir(exportDir, { recursive: true });

  // 1. Load real fonts and brand kit
  const fonts = {
    heading: loadFont("assets/fonts/SpaceGrotesk-Bold.ttf"),
    body: loadFont("assets/fonts/Inter-Regular.ttf"),
  };

  const { brandKits } = loadContent();
  const brand =
    brandKits["test-logos"] ||
    brandKits["acm-nitsurat"] ||
    Object.values(brandKits)[0];

  console.log(`[1] Loaded brand kit: "${brand.id}" (${brand.name})`);
  console.log(
    `    Logos defined: primary=${brand.logos?.primary?.file}, secondary=${brand.logos?.secondary?.file}`
  );

  // 2. Compose realistic draft
  const draftsResult = composeDrafts(sampleEventSpec, {
    brand,
    qrEnabled: false,
  });
  const draft = draftsResult.drafts[0];
  console.log(
    `[2] Composed draft archetype: ${draft.look.attributes.archetype || draft.look.id} (mode: ${draft.look.attributes.mode})\n`
  );

  // 3. Define 9 sample people across 4 roles
  const people9 = [
    {
      id: "HX26-P-001",
      name: "Preet Patel",
      roleId: "participant",
      org: "SVNIT Surat",
    },
    {
      id: "HX26-P-002",
      name: "Aarav Sharma",
      roleId: "participant",
      org: "ACM Student Chapter",
    },
    {
      id: "HX26-P-003",
      name: "Diya Verma",
      roleId: "participant",
      org: "IIT Bombay",
    },
    {
      id: "HX26-V-001",
      name: "Rohan Gupta",
      roleId: "volunteer",
      org: "NIT Surat Volunteers",
    },
    {
      id: "HX26-V-002",
      name: "Ananya Iyer",
      roleId: "volunteer",
      org: "Logistics Team",
    },
    {
      id: "HX26-M-001",
      name: "Dr. Alok Kumar",
      roleId: "mentor",
      org: "Department of CSE",
    },
    {
      id: "HX26-M-002",
      name: "Meera Nair",
      roleId: "mentor",
      org: "Google Developers",
    },
    {
      id: "HX26-O-001",
      name: "Kabir Joshi",
      roleId: "organizer",
      org: "Lead Organizer",
    },
    {
      id: "HX26-O-002",
      name: "Sanya Roy",
      roleId: "organizer",
      org: "Technical Lead",
    },
  ];

  // 4. Export single card PDF (60 x 91.6 mm at bleed 3)
  console.log("[4] Exporting single-card print-ready vector PDF...");
  const singlePdfPath = path.join(exportDir, "single-card.pdf");
  const singleRes = await exportCard(
    {
      eventSpec: sampleEventSpec,
      draft,
      person: people9[0],
      brand,
      fonts,
    },
    { format: "pdf", bleedMm: 3 },
    { outputPath: singlePdfPath, acknowledgedWarnings: true }
  );

  if (singleRes.ok && singleRes.data) {
    const inspect = inspectPdfBytes(singleRes.data);
    const box = inspect.mediaBoxes[0];
    console.log(`    Saved: ${singlePdfPath}`);
    console.log(`    File size: ${singleRes.data.length} bytes`);
    console.log(
      `    Page size: ${box.widthMm.toFixed(1)} x ${box.heightMm.toFixed(1)} mm (MediaBox pt: ${box.widthPt} x ${box.heightPt})`
    );
    console.log(
      `    Embedded fonts: ${inspect.hasEmbeddedFonts ? "YES (font object)" : "NONE (pure vector outlines)"}\n`
    );
  } else {
    console.error(`    Single PDF export failed:`, singleRes.reason);
  }

  // 5. Export 9-card print sheet PDF (A4, 9 cards/page, bleed 3, vector crop marks)
  console.log("[5] Exporting 9-card A4 print sheet PDF (full page)...");
  const sheet9PdfPath = path.join(exportDir, "print-sheet-9cards.pdf");
  const sheet9Res = await exportSheet(
    {
      eventSpec: sampleEventSpec,
      draft,
      people: people9,
      brand,
      fonts,
    },
    { format: "pdf", bleedMm: 3 },
    { outputPath: sheet9PdfPath, acknowledgedWarnings: true }
  );

  if (sheet9Res.ok && sheet9Res.data) {
    console.log(`    Saved: ${sheet9PdfPath}`);
    console.log(`    File size: ${sheet9Res.data.length} bytes`);
    console.log(`    Pages: ${sheet9Res.pageCount}`);
    console.log(
      `    Logo deduplication ratio: ${(sheet9Res.data.length / (singleRes.data?.length || 1)).toFixed(2)}x single card size (NOT 9x!)\n`
    );
  } else {
    console.error(`    Sheet 9 PDF export failed:`, sheet9Res.reason);
  }

  // 6. Export 10-card print sheet PDF (2 pages: 9 cards on page 1, 1 on page 2)
  console.log(
    "[6] Exporting 10-card A4 print sheet PDF (2 pages, partly filled page 2)..."
  );
  const people10 = [
    ...people9,
    {
      id: "HX26-P-010",
      name: "Tanya Sen",
      roleId: "participant",
      org: "NIT Rourkela",
    },
  ];
  const sheet10PdfPath = path.join(exportDir, "print-sheet-10cards.pdf");
  const sheet10Res = await exportSheet(
    {
      eventSpec: sampleEventSpec,
      draft,
      people: people10,
      brand,
      fonts,
    },
    { format: "pdf", bleedMm: 3 },
    { outputPath: sheet10PdfPath, acknowledgedWarnings: true }
  );

  if (sheet10Res.ok && sheet10Res.data) {
    console.log(`    Saved: ${sheet10PdfPath}`);
    console.log(`    File size: ${sheet10Res.data.length} bytes`);
    console.log(`    Page count: ${sheet10Res.pageCount}\n`);
  } else {
    console.error(`    Sheet 10 PDF export failed:`, sheet10Res.reason);
  }

  // 7. Export streamed ZIP archive containing individual PDFs and manifest.json
  console.log(
    "[7] Exporting streamed ZIP archive (individual card PDFs + manifest.json)..."
  );
  const zipPath = path.join(exportDir, "cards-batch.zip");
  const zipRes = await exportZip(
    {
      eventSpec: sampleEventSpec,
      draft,
      people: people9,
      brand,
      fonts,
    },
    { format: "pdf" },
    { outputPath: zipPath, acknowledgedWarnings: true }
  );

  if (zipRes.ok && zipRes.data) {
    console.log(`    Saved: ${zipPath}`);
    console.log(`    Archive size: ${zipRes.data.length} bytes`);
    console.log(`    Cards in manifest: ${zipRes.manifest?.length}`);
    console.log(
      `    Manifest preview (id, roleId, fileName only):\n`,
      JSON.stringify(zipRes.manifest?.slice(0, 3), null, 4),
      "\n"
    );
  }

  // 8. Demonstrate D-09 Gate refusal with unknown role
  console.log(
    "[8] Demonstrating D-09 export gate refusal with invalid role ('boss')..."
  );
  const badPeople = [
    { ...people9[0] },
    {
      id: "HX26-BAD-01",
      name: "Secret Person",
      roleId: "boss",
      org: "Unauthorized",
    },
  ];
  const badOutPath = path.join(exportDir, "should-not-exist.pdf");
  const badRes = await exportSheet(
    {
      eventSpec: sampleEventSpec,
      draft,
      people: badPeople,
      brand,
      fonts,
    },
    { format: "pdf" },
    { outputPath: badOutPath }
  );

  console.log(`    Gate refused export: ${!badRes.ok}`);
  console.log(
    `    Failing person IDs (IDs only, no names/emails): ${JSON.stringify(badRes.failingPersonIds)}`
  );
  console.log(
    `    Output file exists: ${fs.existsSync(badOutPath)} (zero bytes written to disk)\n`
  );

  // 9. Demonstrate Vector QR module
  console.log("[9] Demonstrating vector QR path generation (server/export/qr.js)...");
  const qrUrl = "https://acmnitsurat.org/verify?id=HX26-P-001";
  const qr = qrPath(qrUrl, { errorCorrectionLevel: "M", margin: 1 });
  console.log(`    QR target: ${qrUrl}`);
  console.log(
    `    Grid modules: ${qr.gridSize} x ${qr.gridSize} (with margin: ${qr.modules} x ${qr.modules})`
  );
  console.log(
    `    Vector SVG path length: ${qr.path.length} chars (pure vector rectangle runs)\n`
  );

  console.log(
    "================================================================="
  );
  console.log("=== HAND-CHECK LIST ===");
  console.log("1. Open exports/print-sheet-9cards.pdf in Acrobat or browser.");
  console.log("2. Print at 100% scale (no fit-to-page) to PDF or paper.");
  console.log("3. Verify 9 cards fit neatly in 3x3 grid on A4.");
  console.log(
    "4. Verify bleed color reaches out 3mm past trim to the crop marks."
  );
  console.log(
    "5. Open exports/cards-batch.zip and verify filenames are IDs only (e.g. HX26-P-001.pdf)."
  );
  console.log(
    "6. Inspect manifest.json inside the ZIP: confirm it has ONLY id, roleId, fileName."
  );
  console.log(
    "=================================================================\n"
  );
}

main().catch((err) => {
  console.error("Demo failed with error:", err);
  process.exit(1);
});
