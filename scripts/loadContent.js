// @ts-check
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  Block,
  BrandKit,
  Look,
  Skeleton,
  Theme,
} from "../core/schemas.js";

/**
 * @module scripts/loadContent
 * Reads and validates design definitions from content/ using Zod schemas.
 * Throws a descriptive error naming the file and problem if validation fails.
 * Note: core/ remains pure; this loader lives in scripts/ (D-06).
 */

/**
 * Recursively discovers all .json files in a directory.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function findJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const results = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findJsonFiles(fullPath));
    } else if (entry.endsWith(".json")) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Loads a JSON file and parses it.
 *
 * @param {string} filePath
 * @returns {any}
 */
function readJson(filePath) {
  try {
    const text = readFileSync(filePath, "utf8");
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to read/parse JSON in file "${filePath}": ${err?.message || err}`);
  }
}

/**
 * Reads intrinsic width and height from PNG, JPEG, or SVG image buffers.
 * Pure JS zero-dependency header parser.
 *
 * @param {Buffer} buf
 * @param {string} [filePath]
 * @returns {{ width: number, height: number }}
 */
export function getImageDimensions(buf, filePath = "") {
  // 1. PNG: signature 89 50 4E 47 0D 0A 1A 0A; width at byte 16, height at byte 20
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  }

  // 2. JPEG: signature FF D8; scan segments for SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset < buf.length) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        if (offset + 9 > buf.length) break;
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        return { width, height };
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
      } else {
        if (offset + 4 > buf.length) break;
        const len = buf.readUInt16BE(offset + 2);
        offset += 2 + len;
      }
    }
  }

  // 3. SVG: parse viewBox or width/height attributes
  const text = buf.toString("utf8");
  if (text.includes("<svg")) {
    const viewBoxMatch = text.match(/viewBox=["']\s*[\d.-]+\s+[\d.-]+\s+([\d.-]+)\s+([\d.-]+)["']/i);
    if (viewBoxMatch) {
      return { width: parseFloat(viewBoxMatch[1]), height: parseFloat(viewBoxMatch[2]) };
    }
    const widthMatch = text.match(/width=["']([\d.-]+)(?:px)?["']/i);
    const heightMatch = text.match(/height=["']([\d.-]+)(?:px)?["']/i);
    if (widthMatch && heightMatch) {
      return { width: parseFloat(widthMatch[1]), height: parseFloat(heightMatch[1]) };
    }
  }

  throw new Error(`Unable to determine image dimensions for "${filePath}". Supported formats: PNG, JPEG, SVG.`);
}

/**
 * Loads a logo file, checks size limit (500 KB), and returns dimensions + data URI.
 *
 * @param {string} relativePath
 * @param {string} brandId
 * @returns {{ dataUri: string, width: number, height: number }}
 */
export function loadLogoAsset(relativePath, brandId) {
  const resolved = resolve(process.cwd(), relativePath);
  if (!existsSync(resolved)) {
    throw new Error(`Logo file not found: "${relativePath}" (resolved: "${resolved}") for brand kit "${brandId}"`);
  }

  const stat = statSync(resolved);
  if (stat.size > 500 * 1024) {
    console.warn(
      `[WARNING] Logo file "${relativePath}" is ${(stat.size / 1024).toFixed(1)} KB (> 500 KB). Please resize it to keep cards lightweight.`
    );
  }

  const buf = readFileSync(resolved);
  const { width, height } = getImageDimensions(buf, relativePath);

  let mime = "image/png";
  if (relativePath.endsWith(".jpg") || relativePath.endsWith(".jpeg")) {
    mime = "image/jpeg";
  } else if (relativePath.endsWith(".svg")) {
    mime = "image/svg+xml";
  }

  const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
  return { dataUri, width, height };
}

/**
 * Loads and validates all content directories.
 *
 * @param {string} [baseDir]
 * @returns {{
 *   skeletons: Record<string, any>,
 *   blocks: Record<string, any>,
 *   themes: Record<string, any>,
 *   looks: Record<string, any>,
 *   brandKits: Record<string, any>,
 *   compatibility: any,
 * }}
 */
export function loadContent(baseDir = resolve(process.cwd(), "content")) {
  /** @type {Record<string, any>} */
  const skeletons = {};
  /** @type {Record<string, any>} */
  const blocks = {};
  /** @type {Record<string, any>} */
  const themes = {};
  /** @type {Record<string, any>} */
  const looks = {};
  /** @type {Record<string, any>} */
  const brandKits = {};

  // 1. Skeletons
  const skeletonFiles = findJsonFiles(join(baseDir, "skeletons"));
  for (const file of skeletonFiles) {
    const raw = readJson(file);
    const parsed = Skeleton.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Content validation error in file "${file}": ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`
      );
    }
    skeletons[parsed.data.id] = parsed.data;
  }

  // 2. Blocks
  const blockFiles = findJsonFiles(join(baseDir, "blocks"));
  for (const file of blockFiles) {
    const raw = readJson(file);
    const parsed = Block.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Content validation error in file "${file}": ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`
      );
    }
    blocks[parsed.data.id] = parsed.data;
  }

  // 3. Themes
  const themeFiles = findJsonFiles(join(baseDir, "themes"));
  for (const file of themeFiles) {
    const raw = readJson(file);
    const parsed = Theme.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Content validation error in file "${file}": ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`
      );
    }
    themes[parsed.data.id] = parsed.data;
  }

  // 4. Looks
  const lookFiles = findJsonFiles(join(baseDir, "looks"));
  for (const file of lookFiles) {
    const raw = readJson(file);
    const parsed = Look.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Content validation error in file "${file}": ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`
      );
    }
    looks[parsed.data.id] = parsed.data;
  }

  // 5. Brand Kits
  const brandFiles = findJsonFiles(join(baseDir, "brand-kits"));
  for (const file of brandFiles) {
    const raw = readJson(file);
    const parsed = BrandKit.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Content validation error in file "${file}": ${parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`
      );
    }
    const brandKit = parsed.data;

    // Load actual logo image assets if present on disk
    for (const logoKey of ["primary", "secondary"]) {
      const logo = brandKit.logos?.[logoKey];
      if (logo?.file) {
        const resolvedPath = resolve(process.cwd(), logo.file);
        if (existsSync(resolvedPath)) {
          const asset = loadLogoAsset(logo.file, brandKit.id);
          logo.dataUri = asset.dataUri;
          logo.width = asset.width;
          logo.height = asset.height;
        } else if (brandKit.id !== "acm-nitsurat") {
          throw new Error(
            `Logo file not found: "${logo.file}" for brand kit "${brandKit.id}"`
          );
        }
      }
    }

    brandKits[brandKit.id] = brandKit;
  }

  // 6. Compatibility Rules (spec 9.5)
  let compatibility = null;
  const compatPath = join(baseDir, "compatibility.json");
  if (existsSync(compatPath)) {
    compatibility = readJson(compatPath);
  }

  return { skeletons, blocks, themes, looks, brandKits, compatibility };
}
