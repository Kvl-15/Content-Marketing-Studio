import fs from "node:fs";
import path from "node:path";
import { ZipArchive } from "archiver";
import { parseExportSettings } from "../../core/exportSettings.js";
import { renderCard } from "../../core/render.js";
import { checkExportGate } from "./gate.js";
import { uniqueFileNames } from "./fileName.js";
import { exportCard } from "./exportCard.js";
import { exportSheet } from "./exportSheet.js";
import { withBrowser } from "./pdf.js";

/**
 * @typedef {import("../../core/exportSettings.js").ExportSettings} ExportSettings
 * @typedef {import("../../core/schemas.js").EventSpec} EventSpec
 * @typedef {import("../../core/schemas.js").Person} Person
 * @typedef {import("../../core/schemas.js").BrandKit} BrandKit
 */

/**
 * Creates a ZIP archive containing individual card files and a privacy-safe manifest.json
 * using streaming archiver.
 *
 * Requirements:
 * 1. Strict D-09 gate on EVERY card BEFORE browser launch: if ANY card fails, refuse
 *    the entire batch, list failing person IDs (no names/emails), write zero bytes,
 *    and NEVER launch Chromium.
 * 2. Filenames generated strictly from uniqueFileNames (ids only, collision resolved).
 * 3. manifest.json contains ONLY { id, roleId, fileName } (privacy rule: no names, no emails).
 * 4. Streamed via archiver.
 * 5. Single browser instance reused for entire batch if format is PDF, closed in finally block.
 *
 * @param {{
 *   eventSpec: EventSpec;
 *   draft: any;
 *   people?: Person[];
 *   cards?: Array<{ person: Person, draft?: any, photoSource?: any }>;
 *   brand?: any;
 *   fonts?: any;
 *   photoSource?: any;
 * }} input
 * @param {unknown} [settingsInput]
 * @param {{
 *   acknowledgedWarnings?: boolean;
 *   outputPath?: string;
 *   fileName?: string;
 *   browser?: import("puppeteer").Browser;
 * }} [options]
 * @returns {Promise<{
 *   ok: boolean;
 *   fileName?: string;
 *   mimeType?: string;
 *   data?: Buffer;
 *   manifest?: Array<{ id: string, roleId: string, fileName: string }>;
 *   cardsCount?: number;
 *   failingPersonIds?: string[];
 *   issues?: any[];
 *   errors?: any[];
 *   warnings?: any[];
 *   reason?: string | null;
 * }>}
 */
export async function exportZip(input, settingsInput = {}, options = {}) {
  // 1. Parse and validate export settings
  const settings = parseExportSettings(settingsInput);

  // 2. Refuse landscape orientation (portrait CR80 only)
  if (settings.orientation === "landscape") {
    return {
      ok: false,
      issues: [],
      errors: [
        {
          severity: "error",
          code: "UNSUPPORTED_ORIENTATION",
          message:
            "Orientation 'landscape' is not supported in exportZip: card layouts are portrait-only and do not re-flow for a landscape canvas. Refused to prevent broken card output. Deferred to Stage B.",
        },
      ],
      warnings: [],
      reason:
        "Orientation 'landscape' is not supported: card layouts are portrait-only and do not re-flow for a landscape canvas.",
    };
  }

  // 3. Extract people list
  const peopleList =
    input.people ||
    (Array.isArray(input.cards) ? input.cards.map((c) => c.person) : []);

  if (!Array.isArray(peopleList) || peopleList.length === 0) {
    return {
      ok: false,
      issues: [],
      errors: [
        {
          severity: "error",
          code: "EMPTY_CARD_LIST",
          message: "Cannot generate batch ZIP: card list is empty",
        },
      ],
      warnings: [],
      reason: "Card list cannot be empty",
    };
  }

  // 4. Preflight asset checks (fonts and logos)
  if (!input?.fonts || !input.fonts.heading || !input.fonts.body) {
    return {
      ok: false,
      issues: [],
      errors: [
        {
          severity: "error",
          code: "MISSING_FONTS",
          message:
            "Export requires loaded OpenType fonts in input.fonts (heading and body) for text outline rendering (Rule D-28)",
        },
      ],
      warnings: [],
      reason:
        "Export refused: missing loaded fonts in input.fonts (required for D-28 text outline rendering)",
    };
  }

  if (input?.brand?.logos && typeof input.brand.logos === "object") {
    for (const [key, logo] of Object.entries(input.brand.logos)) {
      if (logo && (!logo.dataUri || !logo.width || !logo.height)) {
        return {
          ok: false,
          issues: [],
          errors: [
            {
              severity: "error",
              code: "MISSING_LOGO_ASSETS",
              message: `Brand kit logo "${key}" is missing loaded image data (dataUri, width, height)`,
            },
          ],
          warnings: [],
          reason: `Export refused: brand kit logo "${key}" is missing loaded image data (dataUri, width, height)`,
        };
      }
    }
  }

  // 5. PHASE 1: Render each card and run D-09 GATE on EVERY card BEFORE launching Chromium
  /** @type {string[]} Failing person IDs only */
  const failingPersonIds = [];
  /** @type {any[]} */
  const allErrors = [];
  /** @type {any[]} */
  const allWarnings = [];

  for (let idx = 0; idx < peopleList.length; idx++) {
    const person = peopleList[idx];
    const cardItem = input.cards ? input.cards[idx] : null;
    const cardDraft = cardItem?.draft || input.draft;
    const photoSource = cardItem?.photoSource || input.photoSource;

    const renderInput = {
      skeleton: cardDraft?.skeleton,
      blocks: cardDraft?.blocks,
      theme: cardDraft?.theme,
      look: cardDraft?.look,
      person,
      photoSource,
      brand: input.brand,
      fonts: input.fonts,
      event: input.eventSpec,
      card: {
        widthMm: settings.card.widthMm,
        heightMm: settings.card.heightMm,
        orientation: settings.orientation,
      },
      bleedMm: settings.bleedMm,
    };

    const rendered = renderCard(renderInput);
    const gateResult = checkExportGate(rendered.issues, {
      acknowledgedWarnings: options.acknowledgedWarnings ?? false,
    });

    if (!gateResult.ok) {
      const pid =
        person && typeof person.id === "string" && person.id.trim() !== ""
          ? person.id
          : `card-${idx}`;
      failingPersonIds.push(pid);
      allErrors.push(...gateResult.errors);
      allWarnings.push(...gateResult.warnings);
    } else {
      allWarnings.push(...gateResult.warnings);
    }
  }

  // Strict batch gate: If ANY card failed, refuse whole batch immediately!
  // No browser is launched and zero bytes are written.
  if (failingPersonIds.length > 0) {
    return {
      ok: false,
      failingPersonIds,
      issues: allErrors,
      errors: allErrors,
      warnings: allWarnings,
      reason: `Export refused: ${failingPersonIds.length} card(s) failed D-09 gate. Failing person IDs: ${failingPersonIds.join(", ")}`,
    };
  }

  // 6. PHASE 2: Generate unique file names (ids only)
  const fileNames = uniqueFileNames(peopleList, settings.format);

  // 7. PHASE 3: Privacy-safe manifest entries: id, roleId, fileName ONLY
  const manifest = peopleList.map((p, idx) => ({
    id: p.id || `card-${idx}`,
    roleId: p.roleId || "participant",
    fileName: fileNames[idx],
  }));

  // 8. PHASE 4: Export cards and stream into ZIP archive
  const executeArchival = async (browserInstance) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    /** @type {Buffer[]} */
    const chunks = [];

    const streamPromise = new Promise((resolve, reject) => {
      archive.on("data", (chunk) => chunks.push(chunk));
      archive.on("error", (err) => reject(err));
      archive.on("end", () => resolve(Buffer.concat(chunks)));
    });

    try {
      for (let idx = 0; idx < peopleList.length; idx++) {
        const person = peopleList[idx];
        const cardItem = input.cards ? input.cards[idx] : null;
        const cardDraft = cardItem?.draft || input.draft;
        const photoSource = cardItem?.photoSource || input.photoSource;

        const cardExport = await exportCard(
          {
            eventSpec: input.eventSpec,
            draft: cardDraft,
            person,
            photoSource,
            brand: input.brand,
            fonts: input.fonts,
          },
          settings,
          {
            acknowledgedWarnings: options.acknowledgedWarnings ?? false,
            fileName: fileNames[idx],
            browser: browserInstance,
          }
        );

        if (!cardExport.ok || !cardExport.data) {
          throw new Error(
            `Unexpected export failure on card "${person.id}": ${cardExport.reason || "unknown"}`
          );
        }

        archive.append(cardExport.data, { name: fileNames[idx] });
      }

      // Append manifest.json with id, roleId, fileName ONLY
      const manifestJson = JSON.stringify(manifest, null, 2);
      archive.append(manifestJson, { name: "manifest.json" });

      await archive.finalize();
      return await streamPromise;
    } catch (err) {
      archive.destroy();
      throw err;
    }
  };

  /** @type {Buffer} */
  let zipBuffer;
  if (settings.format === "pdf") {
    // Single browser instance reused for entire batch, closed in finally block
    zipBuffer = await withBrowser(
      async (browser) => executeArchival(browser),
      { browser: options.browser }
    );
  } else {
    zipBuffer = await executeArchival(undefined);
  }

  const defaultFileName = "cards-export.zip";
  const fileName = options.fileName || defaultFileName;

  if (options.outputPath) {
    await fs.promises.mkdir(path.dirname(options.outputPath), {
      recursive: true,
    });
    await fs.promises.writeFile(options.outputPath, zipBuffer);
  }

  return {
    ok: true,
    fileName,
    mimeType: "application/zip",
    data: zipBuffer,
    manifest,
    cardsCount: peopleList.length,
    issues: [],
    warnings: allWarnings,
  };
}

/**
 * High-level batch export dispatcher:
 * - mode === "sheets": exports print sheets PDF via exportSheet.
 * - mode === "all": exports streamed ZIP bundle via exportZip.
 * - mode === "single": exports single card via exportCard.
 *
 * @param {{
 *   eventSpec: EventSpec;
 *   draft: any;
 *   people?: Person[];
 *   cards?: Array<{ person: Person, draft?: any, photoSource?: any }>;
 *   brand?: any;
 *   fonts?: any;
 *   photoSource?: any;
 * }} input
 * @param {unknown} [settingsInput]
 * @param {{
 *   acknowledgedWarnings?: boolean;
 *   outputPath?: string;
 *   fileName?: string;
 *   browser?: import("puppeteer").Browser;
 * }} [options]
 * @returns {Promise<any>}
 */
export async function exportBatch(input, settingsInput = {}, options = {}) {
  const settings = parseExportSettings(settingsInput);

  if (settings.mode === "sheets") {
    return exportSheet(input, settings, options);
  }

  if (settings.mode === "all") {
    return exportZip(input, settings, options);
  }

  // mode === "single"
  const peopleList =
    input.people ||
    (Array.isArray(input.cards) ? input.cards.map((c) => c.person) : []);
  const person = peopleList[0];
  const cardItem = input.cards ? input.cards[0] : null;
  const cardDraft = cardItem?.draft || input.draft;
  const photoSource = cardItem?.photoSource || input.photoSource;

  return exportCard(
    {
      eventSpec: input.eventSpec,
      draft: cardDraft,
      person,
      photoSource,
      brand: input.brand,
      fonts: input.fonts,
    },
    settings,
    options
  );
}
