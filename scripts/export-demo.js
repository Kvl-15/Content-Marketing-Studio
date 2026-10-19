// @ts-check
import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import { exportCard, fileNameFor } from "../server/export/index.js";
import { sampleEventSpec } from "../core/fixtures.js";
import { composeDrafts } from "../core/composer.js";
import { loadContent } from "./loadContent.js";

// Load fonts using opentype.parse for text outline rendering (Rule D-28)
function loadFont(relPath) {
  const fullPath = path.resolve(process.cwd(), relPath);
  const buf = fs.readFileSync(fullPath);
  return opentype.parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
}

async function main() {
  console.log(
    "=== ACM Content Marketing Studio: Single-Card Export Demo (E2a) ===\n",
  );

  const exportDir = path.resolve(process.cwd(), "exports");
  await fs.promises.mkdir(exportDir, { recursive: true });

  // Load real content: fonts and brand kit with real logo assets
  const fonts = {
    heading: loadFont("assets/fonts/SpaceGrotesk-Bold.ttf"),
    body: loadFont("assets/fonts/Inter-Regular.ttf"),
  };

  const { brandKits } = loadContent();
  const brand =
    brandKits["test-logos"] ||
    brandKits["acm-nitsurat"] ||
    Object.values(brandKits)[0];

  console.log(`Loaded brand kit: "${brand.id}" (${brand.name})`);
  console.log(
    `Logos defined: primary=${brand.logos?.primary?.file} (hasDataUri: ${!!brand.logos?.primary?.dataUri}), secondary=${brand.logos?.secondary?.file} (hasDataUri: ${!!brand.logos?.secondary?.dataUri})`,
  );

  // Compose drafts to obtain a realistic validated card draft
  const draftsResult = composeDrafts(sampleEventSpec, {
    brand,
    qrEnabled: false,
  });
  const draft = draftsResult.drafts[0];

  console.log(
    `Using draft archetype: ${draft.look.attributes.archetype || draft.look.id}`,
  );

  // 3 sample people covering 3 roles
  const people = [
    {
      id: "HX26-P-001",
      name: "Preet Patel",
      roleId: "participant",
      org: "SVNIT",
      photo: "https://example.org/photos/preet.jpg",
    },
    {
      id: "HX26-M-001",
      name: "Priya Sharma",
      roleId: "mentor",
      org: "Google",
      photo: "https://example.org/photos/priya.jpg",
    },
    {
      id: "HX26-O-001",
      name: "Kabir Mehta",
      roleId: "organizer",
      org: "ACM Student Chapter",
      photo: "https://example.org/photos/kabir.jpg",
    },
  ];

  console.log(
    "\n--- Exporting Valid Cards (3 roles: participant, mentor, organizer) ---",
  );

  for (const person of people) {
    const input = {
      eventSpec: sampleEventSpec,
      draft,
      person,
      brand,
      fonts,
    };

    // 1. Export SVG (bleed 3mm)
    const svgSettings = {
      format: "svg",
      bleedMm: 3,
    };
    const svgFileName = fileNameFor(person, "svg");
    const svgPath = path.join(exportDir, svgFileName);

    const svgResult = await exportCard(input, svgSettings, {
      outputPath: svgPath,
    });
    if (svgResult.ok) {
      const stats = await fs.promises.stat(svgPath);
      console.log(
        `[SVG] ${person.roleId.padEnd(12)} -> ${svgFileName} (${stats.size} bytes), issues: ${JSON.stringify(svgResult.issues || [])}`,
      );
    } else {
      console.error(`[SVG ERROR] ${svgResult.reason}`);
    }

    // 2. Export PNG (300 DPI, bleed 3mm)
    const pngSettings = {
      format: "png",
      dpi: 300,
      bleedMm: 3,
    };
    const pngFileName = fileNameFor(person, "png");
    const pngPath = path.join(exportDir, pngFileName);

    const pngResult = await exportCard(input, pngSettings, {
      outputPath: pngPath,
    });
    if (pngResult.ok) {
      const stats = await fs.promises.stat(pngPath);
      console.log(
        `[PNG] ${person.roleId.padEnd(12)} -> ${pngFileName} (${stats.size} bytes, ${pngResult.widthPx}x${pngResult.heightPx} px @ ${pngResult.dpi} DPI), issues: ${JSON.stringify(pngResult.issues || [])}`,
      );
    } else {
      console.error(`[PNG ERROR] ${pngResult.reason}`);
    }
  }

  // Detailed analysis of HX26-P-001.svg
  console.log("\n--- Detailed Analysis of HX26-P-001.svg ---");
  const p1SvgPath = path.join(exportDir, "HX26-P-001.svg");
  const p1SvgContent = await fs.promises.readFile(p1SvgPath, "utf-8");
  const pathMatches = p1SvgContent.match(/<path[^>]*>/g) || [];
  const imageMatches = p1SvgContent.match(/<image[^>]*>/g) || [];

  console.log(`File size on disk: ${p1SvgContent.length} bytes`);
  console.log(`Number of <path> elements: ${pathMatches.length}`);
  console.log(`Number of <image> elements: ${imageMatches.length}`);

  imageMatches.forEach((img, i) => {
    const hrefMatch = img.match(/href="([^"]*)"/);
    const href = hrefMatch ? hrefMatch[1] : "";
    console.log(
      `  Image ${i + 1}: length=${href.length} characters (MIME: ${href.slice(0, 30)}...)`,
    );
  });

  // 3. Demonstrate D-09 pre-export gate refusal with unknown role
  console.log("\n--- Demonstrating D-09 Gate Refusal (Unknown Role) ---");
  const invalidPerson = {
    id: "HX26-BAD-01",
    name: "Unknown Role User",
    roleId: "boss", // Not in sampleEventSpec.roles
    org: "Rogue Inc",
    photo: "https://example.org/photos/bad.jpg",
  };

  const badInput = {
    eventSpec: sampleEventSpec,
    draft,
    person: invalidPerson,
    brand,
    fonts,
  };

  const badOutputPath = path.join(exportDir, "HX26-BAD-01.png");
  const badResult = await exportCard(
    badInput,
    { format: "png", dpi: 300 },
    { outputPath: badOutputPath },
  );

  console.log(`Export result ok: ${badResult.ok}`);
  console.log(`Refusal reason: ${badResult.reason}`);
  console.log(
    `Errors surfaced:`,
    badResult.errors?.map((e) => `${e.code}: ${e.message}`),
  );

  const fileExists = fs.existsSync(badOutputPath);
  console.log(
    `Output file created on disk: ${fileExists} (Must be false: no file written when refused)`,
  );

  console.log("\nExport demo completed successfully.");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
