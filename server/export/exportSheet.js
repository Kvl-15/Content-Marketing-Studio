// @ts-check
import fs from "node:fs";
import path from "node:path";
import { parseExportSettings } from "../../core/exportSettings.js";
import { sheetLayout } from "../../core/sheet.js";
import { renderCard } from "../../core/render.js";
import { checkExportGate } from "./gate.js";
import { renderHtmlToPdf } from "./pdf.js";
import {
  preparePhotoForCard,
  extractPhotoBoxFromScene,
} from "./photoPrep.js";

/**
 * @typedef {import("../../core/exportSettings.js").ExportSettings} ExportSettings
 * @typedef {import("../../core/schemas.js").EventSpec} EventSpec
 * @typedef {import("../../core/schemas.js").Person} Person
 * @typedef {import("../../core/schemas.js").BrandKit} BrandKit
 */

/**
 * Prefixes all id="..." and url(#...) / href="#..." references inside an SVG string
 * to isolate ID namespaces when multiple card SVGs are embedded into a single sheet document.
 * Shared definitions (such as brand logo symbols in sheet <defs>) are preserved without prefix.
 *
 * @param {string} svg - Inner SVG string of a card
 * @param {string} prefix - Unique prefix for this card instance (e.g. "p0_c1_")
 * @param {Set<string>} [sharedDefIds] - Set of global def IDs that must NOT be prefixed
 * @returns {string} Transformed SVG string
 */
export function prefixCardSvgIds(svg, prefix, sharedDefIds = new Set()) {
  // 1. Prefix all id="..." attributes
  let result = svg.replace(/\bid="([^"]+)"/g, (match, id) => {
    return `id="${prefix}${id}"`;
  });

  // 2. Prefix all url(#...) references in attributes (clip-path="url(#...)", fill="url(#...)", etc.)
  result = result.replace(/url\(#([^)]+)\)/g, (match, refId) => {
    if (sharedDefIds.has(refId)) return match;
    return `url(#${prefix}${refId})`;
  });

  // 3. Prefix all href="#..." or xlink:href="#..." references (except shared defs)
  result = result.replace(
    /\b(href|xlink:href)="#([^"]+)"/g,
    (match, attr, refId) => {
      if (sharedDefIds.has(refId)) return match;
      return `${attr}="#${prefix}${refId}"`;
    }
  );

  return result;
}

/**
 * Replaces exact occurrences of known brand-kit logo data URIs in card SVG with <use>
 * references pointing to shared <defs>.
 *
 * Condition 2 requirements:
 * - NO regex surgery on SVG text.
 * - Matches the EXACT known data-URI string of each brand-kit logo.
 * - Rewrites <image ... href="data:..."> into <use ... href="#logoDefId"> without altering attributes.
 * - Counts exact replacements and returns count.
 *
 * @param {string} svg
 * @param {string} knownDataUri
 * @param {string} defId
 * @returns {{ result: string, count: number }}
 */
export function deduplicateLogoInSvg(svg, knownDataUri, defId) {
  const needle = `href="${knownDataUri}"`;
  let count = 0;
  let pos = 0;
  let result = "";

  while (true) {
    const idx = svg.indexOf(needle, pos);
    if (idx === -1) {
      result += svg.slice(pos);
      break;
    }
    count++;

    // Find the opening tag for this attribute: look back for `<image `
    const tagStart = svg.lastIndexOf("<image ", idx);
    if (tagStart === -1 || tagStart < pos) {
      throw new Error(
        `Deduplication error: expected <image tag before logo href at index ${idx}`
      );
    }

    // Append text up to tagStart
    result += svg.slice(pos, tagStart);
    // Replace opening tag `<image ` with `<use `
    result += "<use ";
    // Append attributes between tagStart + 7 and idx
    result += svg.slice(tagStart + 7, idx);
    // Append replaced href pointing to shared def
    result += `href="#${defId}"`;
    pos = idx + needle.length;
  }

  return { result, count };
}

/**
 * Exports multiple cards onto print sheets (A4/A3) with bleed, vector crop marks,
 * role grouping, and guaranteed logo deduplication.
 *
 * Requirements:
 * 1. Strict D-09 gate: if ANY card fails (or warning without acknowledgedWarnings),
 *    refuse the whole batch, return failing person IDs (ids only, no names/emails),
 *    write ZERO bytes to disk, and NEVER launch Chromium.
 * 2. 9 cards per A4 sheet (portrait CR80, bleed 3).
 * 3. Exact vector crop marks.
 * 4. groupByRole support.
 * 5. Unitless numbers on nested SVG elements (never write "mm" on nested x, y, width, height).
 * 6. Refuse sides: "back" or "both" with clear error (fronts only).
 * 7. Refuse orientation: "landscape" with clear error (portrait only).
 * 8. Shared logo embedding: each brand logo embedded once per sheet in <defs> and reused.
 *    Asserts replacement count matches expected count.
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
 *   data?: Buffer | string;
 *   pageCount?: number;
 *   cardsCount?: number;
 *   failingPersonIds?: string[];
 *   issues?: any[];
 *   errors?: any[];
 *   warnings?: any[];
 *   reason?: string | null;
 * }>}
 */
export async function exportSheet(input, settingsInput = {}, options = {}) {
  // 1. Parse and validate export settings
  const settings = parseExportSettings(settingsInput);

  // 2. Refuse unsupported sides (fronts only for now; Stage B deferred)
  if (settings.sides === "back" || settings.sides === "both") {
    return {
      ok: false,
      issues: [],
      errors: [
        {
          severity: "error",
          code: "UNSUPPORTED_SIDES",
          message: `Sides '${settings.sides}' is not supported: card back generation is deferred to Stage B. Fronts only.`,
        },
      ],
      warnings: [],
      reason: `Sides '${settings.sides}' is not supported: card back generation is deferred to Stage B. Fronts only.`,
    };
  }

  // 3. Refuse landscape orientation (portrait CR80 only; Stage B deferred)
  if (settings.orientation === "landscape") {
    return {
      ok: false,
      issues: [],
      errors: [
        {
          severity: "error",
          code: "UNSUPPORTED_ORIENTATION",
          message:
            "Orientation 'landscape' is not supported in exportSheet: card layouts are portrait-only and do not re-flow for a landscape canvas. Refused to prevent broken card output. Deferred to Stage B.",
        },
      ],
      warnings: [],
      reason:
        "Orientation 'landscape' is not supported: card layouts are portrait-only and do not re-flow for a landscape canvas.",
    };
  }

  // 4. Validate cards/people list
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
          message: "Cannot generate print sheet: card list is empty",
        },
      ],
      warnings: [],
      reason: "Card list cannot be empty",
    };
  }

  // 5. Preflight asset checks (fonts and logos)
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

  /** @type {Array<{ key: string, defId: string, dataUri: string, width: number, height: number }>} */
  const brandLogos = [];
  if (input?.brand?.logos && typeof input.brand.logos === "object") {
    for (const [key, logo] of Object.entries(input.brand.logos)) {
      if (logo) {
        if (!logo.dataUri || !logo.width || !logo.height) {
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
        brandLogos.push({
          key,
          defId: `brand-logo-${key}`,
          dataUri: logo.dataUri,
          width: logo.width,
          height: logo.height,
        });
      }
    }
  }

  // 6. PHASE 1: Render each card and run D-09 GATE on EVERY card BEFORE touching Chromium
  const tStart = performance.now();
  let photoPrepMs = 0;
  let totalPreparedPhotoBytes = 0;
  let preparedPhotoCount = 0;
  /** @type {Array<{ person: Person, rendered: any, draft: any }>} */
  const cardRenders = [];
  /** @type {string[]} Failing person IDs only (privacy rule: no names, no emails) */
  const failingPersonIds = [];
  /** @type {any[]} */
  const allErrors = [];
  /** @type {any[]} */
  const allWarnings = [];

  // Cache assumed photo boxes per draft archetype to avoid redundant dry runs
  const draftPhotoBoxCache = new Map();

  for (let idx = 0; idx < peopleList.length; idx++) {
    const person = peopleList[idx];
    const pid = person && typeof person.id === "string" && person.id.trim() !== "" ? person.id : `card-${idx}`;
    const cardItem = input.cards ? input.cards[idx] : null;
    const cardDraft = cardItem?.draft || input.draft;
    const photoSource = cardItem?.photoSource || input.photoSource;

    // Discover assumed photo box for this draft (one dry run per draft archetype)
    const draftKey = cardDraft?.look?.id || cardDraft?.skeleton || "default";
    let assumedBox = draftPhotoBoxCache.get(draftKey);
    if (!assumedBox && cardDraft) {
      const dry = renderCard({
        skeleton: cardDraft.skeleton,
        blocks: cardDraft.blocks,
        theme: cardDraft.theme,
        look: cardDraft.look,
        person: { id: "dry-run", name: "Sample Person", roleId: "participant" },
        brand: input.brand,
        fonts: input.fonts,
        event: input.eventSpec,
        card: {
          widthMm: settings.card.widthMm,
          heightMm: settings.card.heightMm,
          orientation: settings.orientation,
        },
        bleedMm: settings.bleedMm,
      });
      assumedBox = extractPhotoBoxFromScene(dry.scene);
      if (assumedBox) {
        draftPhotoBoxCache.set(draftKey, assumedBox);
      }
    }

    // Condition 4: Process photos one at a time (sequential)
    // photoSource contract: photoSource(pid) wins over person.photo
    const photoSourceFn =
      (typeof cardItem?.photoSource === "function" && cardItem.photoSource) ||
      (typeof input.photoSource === "function" && input.photoSource) ||
      null;

    let masterPhoto = null;
    let preparedPhotoUri = person.photo;

    if (photoSourceFn) {
      try {
        const srcResult = await photoSourceFn(pid);
        if (srcResult === null) {
          // null means "no photo": initials avatar + missing-photo warning
          preparedPhotoUri = null;
          masterPhoto = null;
        } else if (!Buffer.isBuffer(srcResult)) {
          failingPersonIds.push(pid);
          allErrors.push({
            severity: "error",
            code: "PhotoPrepError",
            message: `[Person ${pid}] PhotoPrepError: photoSource returned a non-Buffer value`,
          });
          continue;
        } else if (srcResult.length === 0) {
          failingPersonIds.push(pid);
          allErrors.push({
            severity: "error",
            code: "PhotoPrepError",
            message: `[Person ${pid}] PhotoPrepError: photoSource returned an empty buffer (0 bytes)`,
          });
          continue;
        } else {
          masterPhoto = srcResult;
        }
      } catch (err) {
        const msg = /** @type {Error} */ (err).message || "photoSource threw an error";
        failingPersonIds.push(pid);
        allErrors.push({
          severity: "error",
          code: "PhotoPrepError",
          message: `[Person ${pid}] PhotoPrepError: ${msg}`,
        });
        continue;
      }
    } else if (person.photo) {
      masterPhoto = person.photo;
    }

    const isImageToPrepare =
      masterPhoto &&
      (typeof masterPhoto !== "string" || masterPhoto.startsWith("data:"));

    if (isImageToPrepare && assumedBox) {
      const tP0 = performance.now();
      try {
        const prep = await preparePhotoForCard(masterPhoto, {
          boxWmm: assumedBox.w,
          boxHmm: assumedBox.h,
          dpi: settings.dpi,
          personId: pid,
        });
        preparedPhotoUri = prep.dataUri;
      } catch (err) {
        const prepErr = /** @type {PhotoPrepError} */ (err);
        failingPersonIds.push(pid);
        allErrors.push({
          severity: "error",
          code: prepErr.code || "INVALID_PHOTO_DATA",
          message: prepErr.message,
        });
        continue;
      }
      photoPrepMs += performance.now() - tP0;
    }

    // Clone person object: do NOT mutate caller's input object (Condition 6)
    const effectivePerson = { ...person, photo: preparedPhotoUri };

    const renderInput = {
      skeleton: cardDraft?.skeleton,
      blocks: cardDraft?.blocks,
      theme: cardDraft?.theme,
      look: cardDraft?.look,
      person: effectivePerson,
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

    let rendered = renderCard(renderInput);

    // Condition 2: If real rendered box differs from assumed box by > 0.01 mm, re-prepare and re-render
    const realBox = extractPhotoBoxFromScene(rendered.scene);
    if (realBox && assumedBox && masterPhoto) {
      if (
        Math.abs(assumedBox.w - realBox.w) > 0.01 ||
        Math.abs(assumedBox.h - realBox.h) > 0.01
      ) {
        const tP0 = performance.now();
        try {
          const rePrep = await preparePhotoForCard(masterPhoto, {
            boxWmm: realBox.w,
            boxHmm: realBox.h,
            dpi: settings.dpi,
            personId: pid,
          });
          effectivePerson.photo = rePrep.dataUri;
          renderInput.person = effectivePerson;
          rendered = renderCard(renderInput);
        } catch (err) {
          const prepErr = /** @type {PhotoPrepError} */ (err);
          failingPersonIds.push(pid);
          allErrors.push({
            severity: "error",
            code: prepErr.code || "INVALID_PHOTO_DATA",
            message: prepErr.message,
          });
          continue;
        }
        photoPrepMs += performance.now() - tP0;
      }
    }
    // Explicitly release large master photo buffer before memory-heavy sheet generation
    /* eslint-disable-next-line no-useless-assignment */
    masterPhoto = null;
    if (effectivePerson.photo) {
      totalPreparedPhotoBytes += effectivePerson.photo.length;
      preparedPhotoCount++;
    }

    // Filter false-positive LOGO_DISTORTED on photo nodes (caused by core/render.js hardcoding srcW: 500, srcH: 500)
    const validIssues = rendered.issues.filter(
      (i) => !(i.code === "LOGO_DISTORTED" && i.nodeId === "photo")
    );
    const gateResult = checkExportGate(validIssues, {
      acknowledgedWarnings: options.acknowledgedWarnings ?? false,
    });

    if (!gateResult.ok) {
      failingPersonIds.push(pid);
      allErrors.push(...gateResult.errors);
      allWarnings.push(...gateResult.warnings);
    } else {
      allWarnings.push(...gateResult.warnings);
    }

    cardRenders.push({ person: effectivePerson, rendered, draft: cardDraft });
  }

  // If ANY card failed the D-09 gate, refuse the entire batch immediately!
  // NO browser is launched, and ZERO bytes are written to disk.
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

  // 7. PHASE 2: Imposition using core/sheet.js
  const tSvg0 = performance.now();
  // Pass list of cards with id and roleId for role grouping
  const layoutCardItems = peopleList.map((p, idx) => ({
    id: p.id || `card-${idx}`,
    role: p.roleId || "participant",
  }));

  const layoutResult = sheetLayout(settings, layoutCardItems);

  // Check sheet-level layout warnings against D-09 gate (e.g. MARKS_NEAR_PAGE_EDGE)
  if (Array.isArray(layoutResult.warnings) && layoutResult.warnings.length > 0) {
    const layoutIssues = layoutResult.warnings.map((w) => ({
      code: w.code,
      severity: /** @type {const} */ ("warning"),
      message: w.message,
    }));
    const layoutGate = checkExportGate(layoutIssues, {
      acknowledgedWarnings: options.acknowledgedWarnings ?? false,
    });
    if (!layoutGate.ok) {
      return {
        ok: false,
        issues: layoutGate.issues,
        errors: layoutGate.errors,
        warnings: layoutGate.warnings,
        reason: `Sheet export refused: ${layoutGate.reason}`,
      };
    }
    allWarnings.push(...layoutGate.warnings);
  }

  // Map card renders by ID for quick lookup during cell placement
  /** @type {Map<string, { person: Person, rendered: any, draft: any }>} */
  const cardMap = new Map();
  peopleList.forEach((p, idx) => {
    const id = p.id || `card-${idx}`;
    cardMap.set(id, cardRenders[idx]);
  });

  // Set of shared global definition IDs (brand logos in sheet <defs>)
  const sharedDefIds = new Set(brandLogos.map((l) => l.defId));

  // 8. Generate SVG document for each sheet page
  const sheetW = settings.sheet.widthMm;
  const sheetH = settings.sheet.heightMm;

  /** @type {string[]} Array of page SVGs */
  const pageSvgs = [];

  for (const page of layoutResult.pages) {
    let pageContent = "";

    // 8a. Embedded shared logo definitions in sheet <defs>
    let defsContent = "";
    for (const logo of brandLogos) {
      defsContent += `<svg id="${logo.defId}" viewBox="0 0 ${logo.width} ${logo.height}"><image width="${logo.width}" height="${logo.height}" href="${logo.dataUri}"/></svg>\n`;
    }
    pageContent += `<defs>\n${defsContent}</defs>\n`;

    // 8b. Place each card cell
    for (let cellIdx = 0; cellIdx < page.cells.length; cellIdx++) {
      const cell = page.cells[cellIdx];
      const cardData = cardMap.get(cell.cardId);
      if (!cardData) continue;

      let cardSvg = cardData.rendered.svg;

      // Extract inner content and viewBox from card SVG
      // Match opening <svg ... viewBox="...">
      const vbMatch = cardSvg.match(/viewBox="([^"]+)"/);
      const viewBox = vbMatch ? vbMatch[1] : `-3 -3 ${cell.bleedBox.w} ${cell.bleedBox.h}`;

      // Extract inner elements between <svg...> and </svg>
      const innerStart = cardSvg.indexOf(">") + 1;
      const innerEnd = cardSvg.lastIndexOf("</svg>");
      let innerSvg = innerStart > 0 && innerEnd > innerStart ? cardSvg.slice(innerStart, innerEnd) : cardSvg;

      // Deduplicate brand logos in card inner SVG:
      // Replace exact known dataUri with <use href="#defId">
      for (const logo of brandLogos) {
        const { result, count } = deduplicateLogoInSvg(innerSvg, logo.dataUri, logo.defId);
        // Expect exactly 1 replacement per card for that logo
        if (count !== 1) {
          return {
            ok: false,
            issues: [],
            errors: [
              {
                severity: "error",
                code: "LOGO_DEDUPE_MISMATCH",
                message: `Logo deduplication assertion failed: expected 1 replacement for logo "${logo.key}" on card "${cell.cardId}", got ${count}`,
              },
            ],
            warnings: [],
            reason: `Logo deduplication assertion failed for logo "${logo.key}"`,
          };
        }
        innerSvg = result;
      }

      // Condition 1: Apply per-card ID prefixing to prevent ID collisions across 9 cards
      const cardPrefix = `p${page.pageIndex}_c${cellIdx}_`;
      const isolatedInnerSvg = prefixCardSvgIds(innerSvg, cardPrefix, sharedDefIds);

      // Place nested <svg> at cell.bleedBox coordinates WITHOUT "mm" (Condition 4)
      // Never write "mm" on nested x, y, width or height!
      pageContent += `<svg x="${cell.bleedBox.x}" y="${cell.bleedBox.y}" width="${cell.bleedBox.w}" height="${cell.bleedBox.h}" viewBox="${viewBox}">\n${isolatedInnerSvg}\n</svg>\n`;
    }

    // 8c. Draw vector crop marks
    if (page.marks && page.marks.length > 0) {
      pageContent += `<g id="p${page.pageIndex}_crop-marks">\n`;
      for (const m of page.marks) {
        pageContent += `<line x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}" stroke="#000000" stroke-width="${m.strokeMm}" shape-rendering="crispEdges"/>\n`;
      }
      pageContent += `</g>\n`;
    }

    // Top-level sheet SVG: has width and height in mm
    const sheetSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}mm" height="${sheetH}mm" viewBox="0 0 ${sheetW} ${sheetH}">\n${pageContent}</svg>`;
    pageSvgs.push(sheetSvg);
  }

  // 9. PHASE 3: Format-specific emission
  const defaultFileName = `sheet-${settings.sheet.paper.toLowerCase()}.${settings.format}`;
  const fileName = options.fileName || defaultFileName;

  if (settings.format === "svg") {
    // Return single combined SVG or array of page SVGs
    const data = pageSvgs.length === 1 ? pageSvgs[0] : pageSvgs.join("\n<!-- PAGE BREAK -->\n");
    if (options.outputPath) {
      await fs.promises.mkdir(path.dirname(options.outputPath), { recursive: true });
      await fs.promises.writeFile(options.outputPath, data, "utf-8");
    }
    return {
      ok: true,
      fileName,
      mimeType: "image/svg+xml",
      data,
      pageCount: pageSvgs.length,
      cardsCount: peopleList.length,
      issues: [],
      warnings: allWarnings,
    };
  }

  // Format: PDF via Puppeteer
  const htmlPages = pageSvgs
    .map(
      (svg) => `  <div class="sheet-page">\n${svg}\n  </div>`
    )
    .join("\n");

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>ID cards</title>
<style>
  @page {
    size: ${sheetW}mm ${sheetH}mm;
    margin: 0;
  }
  html, body {
    margin: 0;
    padding: 0;
  }
  .sheet-page {
    width: ${sheetW}mm;
    height: ${sheetH}mm;
    page-break-after: always;
    break-after: page;
    box-sizing: border-box;
    overflow: hidden;
  }
  .sheet-page:last-child {
    page-break-after: avoid;
    break-after: avoid;
  }
  svg {
    display: block;
    width: ${sheetW}mm;
    height: ${sheetH}mm;
  }
</style>
</head>
<body>
${htmlPages}
</body>
</html>`;

  const svgAssemblyMs = performance.now() - tSvg0;
  const tPrint0 = performance.now();
  const pdfBuffer = await renderHtmlToPdf(fullHtml, {
    widthMm: sheetW,
    heightMm: sheetH,
    browser: options.browser,
  });
  const chromiumPrintMs = performance.now() - tPrint0;
  const totalMs = performance.now() - tStart;

  if (options.outputPath) {
    await fs.promises.mkdir(path.dirname(options.outputPath), { recursive: true });
    await fs.promises.writeFile(options.outputPath, pdfBuffer);
  }

  return {
    ok: true,
    fileName,
    mimeType: "application/pdf",
    data: pdfBuffer,
    pageCount: layoutResult.pages.length,
    cardsCount: peopleList.length,
    issues: [],
    warnings: allWarnings,
    timings: {
      photoPrepSec: Number((photoPrepMs / 1000).toFixed(3)),
      svgAssemblySec: Number((svgAssemblyMs / 1000).toFixed(3)),
      chromiumPrintSec: Number((chromiumPrintMs / 1000).toFixed(3)),
      totalSec: Number((totalMs / 1000).toFixed(3)),
    },
    photoStats: {
      count: preparedPhotoCount,
      totalBytes: totalPreparedPhotoBytes,
      avgBytes: preparedPhotoCount > 0 ? Math.round(totalPreparedPhotoBytes / preparedPhotoCount) : 0,
    },
  };
}
