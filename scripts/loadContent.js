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
 * Loads and validates all content directories.
 *
 * @param {string} [baseDir]
 * @returns {{
 *   skeletons: Record<string, any>,
 *   blocks: Record<string, any>,
 *   themes: Record<string, any>,
 *   looks: Record<string, any>,
 *   brandKits: Record<string, any>,
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
    brandKits[parsed.data.id] = parsed.data;
  }

  return { skeletons, blocks, themes, looks, brandKits };
}
