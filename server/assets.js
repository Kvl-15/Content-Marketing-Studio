// @ts-check
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import { loadContent } from "../scripts/loadContent.js";
import { sampleBrandKit } from "../core/fixtures.js";

/**
 * Loads a TTF font file into an OpenType font object.
 *
 * @param {string} relPath
 * @returns {opentype.Font}
 */
function loadFont(relPath) {
  const p = resolve(process.cwd(), relPath);
  if (!existsSync(p)) {
    throw new Error(`Required font file not found at: ${relPath}`);
  }
  const buf = readFileSync(p);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

let cachedAssets = null;

/**
 * Preloads static fonts and brand-kit logo assets from disk once on server startup.
 * The client cannot point to arbitrary files.
 *
 * @returns {{
 *   fonts: { heading: opentype.Font; body: opentype.Font };
 *   fontRegistry: Record<string, { heading: opentype.Font; body: opentype.Font; label?: string }>;
 *   brandKit: any;
 * }}
 */
export function loadServerAssets() {
  if (cachedAssets) return cachedAssets;

  // 1. Preload static TTF fonts from assets/fonts/
  const spaceGroteskBold = loadFont("assets/fonts/SpaceGrotesk-Bold.ttf");
  const interRegular = loadFont("assets/fonts/Inter-Regular.ttf");
  const sourceSerifBold = loadFont("assets/fonts/SourceSerif4-Bold.ttf");
  const sourceSansRegular = loadFont("assets/fonts/SourceSans3-Regular.ttf");

  const fontRegistry = {
    "space-grotesk": {
      heading: spaceGroteskBold,
      body: interRegular,
      label: "Space Grotesk + Inter",
    },
    "source-serif": {
      heading: sourceSerifBold,
      body: sourceSansRegular,
      label: "Source Serif 4 + Source Sans 3",
    },
    default: {
      heading: spaceGroteskBold,
      body: interRegular,
      label: "Space Grotesk + Inter",
    },
  };

  const defaultFonts = {
    heading: spaceGroteskBold,
    body: interRegular,
  };

  // 2. Preload brand kit and logos from content/brand-kits/
  const { brandKits } = loadContent();
  const brandKit =
    brandKits["test-logos"] ||
    brandKits["acm-nitsurat"] ||
    sampleBrandKit;

  cachedAssets = {
    fonts: defaultFonts,
    fontRegistry,
    brandKit,
  };

  return cachedAssets;
}
