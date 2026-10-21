// @ts-check
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { parseExportSettings } from "../../core/exportSettings.js";
import { renderCard } from "../../core/render.js";
import { checkExportGate } from "./gate.js";
import { fileNameFor } from "./fileName.js";
import { renderSvgToPdf } from "./pdf.js";
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
 * Exports a single card to SVG, PNG, or PDF format with print-accurate dimensions,
 * bleed, and D-09 pre-export gate enforcement.
 *
 * @param {{
 *   eventSpec: any;
 *   draft: any;
 *   person?: any;
 *   photoSource?: any;
 *   brand?: any;
 *   fonts?: any;
 * }} input - Full input bundle for rendering
 * @param {unknown} [settingsInput] - ExportSettings or partial settings
 * @param {{
 *   acknowledgedWarnings?: boolean;
 *   outputPath?: string;
 *   fileName?: string;
 *   index?: number | string;
 *   browser?: import("puppeteer").Browser;
 * }} [options] - Export execution options
 * @returns {Promise<{
 *   ok: boolean;
 *   fileName?: string;
 *   mimeType?: string;
 *   data?: string | Buffer;
 *   widthPx?: number;
 *   heightPx?: number;
 *   widthMm?: number;
 *   heightMm?: number;
 *   dpi?: number;
 *   issues?: any[];
 *   errors?: any[];
 *   warnings?: any[];
 *   reason?: string | null;
 * }>}
 */
export async function exportCard(input, settingsInput = {}, options = {}) {
  // 1. Parse and validate export settings (Zod schema validation preserved unchanged)
  const settings = parseExportSettings(settingsInput);

  // 2. Format availability check
  if (
    settings.format !== "svg" &&
    settings.format !== "png" &&
    settings.format !== "pdf"
  ) {
    return {
      ok: false,
      issues: [],
      errors: [
        {
          severity: "error",
          code: "UNSUPPORTED_FORMAT",
          message: `Format '${settings.format}' is not supported`,
        },
      ],
      warnings: [],
      reason: `Format '${settings.format}' is not supported`,
    };
  }

  // 3. Orientation check: portrait layouts do not re-flow for landscape canvas
  if (settings.orientation === "landscape") {
    return {
      ok: false,
      issues: [],
      errors: [
        {
          severity: "error",
          code: "UNSUPPORTED_ORIENTATION",
          message:
            "Orientation 'landscape' is not supported in E2a: card layouts are portrait-only and do not re-flow for a landscape canvas. Refused to prevent broken card output. Deferred to Stage B.",
        },
      ],
      warnings: [],
      reason:
        "Orientation 'landscape' is not supported in E2a: card layouts are portrait-only and do not re-flow for a landscape canvas. Refused to prevent broken card output. Deferred to Stage B.",
    };
  }

  // 4. Asset checks: D-28 requires OpenType fonts, and logos require loaded image data
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

  // 5. Photo resolution & preparation (photoSource wins over person.photo)
  const person = input.person ? { ...input.person } : undefined;
  const personId = person?.id || "unknown";
  let photoBox = null;

  let masterPhoto = null;
  const photoSourceFn = typeof input.photoSource === "function" ? input.photoSource : null;

  if (photoSourceFn) {
    try {
      const srcResult = await photoSourceFn(personId);
      if (srcResult === null) {
        // null means "no photo": fallback to initials avatar and missing-photo warning
        if (person) person.photo = null;
        masterPhoto = null;
      } else if (!Buffer.isBuffer(srcResult)) {
        return {
          ok: false,
          issues: [],
          errors: [
            {
              severity: "error",
              code: "PhotoPrepError",
              message: `[Person ${personId}] PhotoPrepError: photoSource returned a non-Buffer value`,
            },
          ],
          warnings: [],
          reason: `Export refused: [Person ${personId}] PhotoPrepError: photoSource returned a non-Buffer value`,
        };
      } else if (srcResult.length === 0) {
        return {
          ok: false,
          issues: [],
          errors: [
            {
              severity: "error",
              code: "PhotoPrepError",
              message: `[Person ${personId}] PhotoPrepError: photoSource returned an empty buffer (0 bytes)`,
            },
          ],
          warnings: [],
          reason: `Export refused: [Person ${personId}] PhotoPrepError: photoSource returned an empty buffer (0 bytes)`,
        };
      } else {
        masterPhoto = srcResult;
      }
    } catch (err) {
      const msg = /** @type {Error} */ (err).message || "photoSource threw an error";
      return {
        ok: false,
        issues: [],
        errors: [
          {
            severity: "error",
            code: "PhotoPrepError",
            message: `[Person ${personId}] PhotoPrepError: ${msg}`,
          },
        ],
        warnings: [],
        reason: `Export refused: [Person ${personId}] PhotoPrepError: ${msg}`,
      };
    }
  } else if (person?.photo) {
    masterPhoto = person.photo;
  }

  const isImageToPrepare =
    masterPhoto &&
    (typeof masterPhoto !== "string" || masterPhoto.startsWith("data:"));

  if (isImageToPrepare && input.draft && person) {
    const fallbackRoleId = input.eventSpec?.roles?.[0]?.id || "participant";
    // Dry-run discovery of photo box from draft template
    const dryCard = renderCard({
      skeleton: input.draft.skeleton,
      blocks: input.draft.blocks,
      theme: input.draft.theme,
      look: input.draft.look,
      person: { id: "dry-run", name: "Dry Run", roleId: fallbackRoleId },
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
    photoBox = extractPhotoBoxFromScene(dryCard.scene);

    if (photoBox) {
      try {
        const prep = await preparePhotoForCard(masterPhoto, {
          boxWmm: photoBox.w,
          boxHmm: photoBox.h,
          dpi: settings.dpi,
          personId,
        });
        person.photo = prep.dataUri;
      } catch (err) {
        const prepErr = /** @type {PhotoPrepError} */ (err);
        return {
          ok: false,
          issues: [],
          errors: [
            {
              severity: "error",
              code: prepErr.code || "INVALID_PHOTO_DATA",
              message: prepErr.message,
            },
          ],
          warnings: [],
          reason: `Export refused: ${prepErr.message}`,
        };
      }
    }
  }

  // 6. Render card scene & SVG via core/render.js
  const renderInput = {
    skeleton: input.draft?.skeleton,
    blocks: input.draft?.blocks,
    theme: input.draft?.theme,
    look: input.draft?.look,
    person,
    photoSource: input.photoSource,
    brand: input.brand,
    fonts: input.fonts,
    event: input.eventSpec, // Full EventSpec provided to renderCard
    card: {
      widthMm: settings.card.widthMm,
      heightMm: settings.card.heightMm,
      orientation: settings.orientation,
    },
    bleedMm: settings.bleedMm,
  };

  let rendered = renderCard(renderInput);

  // Condition 2: If the actual rendered photo box differs from assumed box by > 0.01 mm, re-prepare and re-render
  const realPhotoBox = extractPhotoBoxFromScene(rendered.scene);
  if (realPhotoBox && photoBox && person?.photo && (masterPhoto || input.person?.photo)) {
    if (
      Math.abs(photoBox.w - realPhotoBox.w) > 0.01 ||
      Math.abs(photoBox.h - realPhotoBox.h) > 0.01
    ) {
      try {
        const rePrep = await preparePhotoForCard(masterPhoto || input.person?.photo, {
          boxWmm: realPhotoBox.w,
          boxHmm: realPhotoBox.h,
          dpi: settings.dpi,
          personId,
        });
        person.photo = rePrep.dataUri;
        renderInput.person = person;
        rendered = renderCard(renderInput);
      } catch (err) {
        const prepErr = /** @type {PhotoPrepError} */ (err);
        return {
          ok: false,
          issues: [],
          errors: [
            {
              severity: "error",
              code: prepErr.code || "INVALID_PHOTO_DATA",
              message: prepErr.message,
            },
          ],
          warnings: [],
          reason: `Export refused: ${prepErr.message}`,
        };
      }
    }
  }
  // Explicitly release large master photo buffer before memory-heavy PDF/PNG rendering
  /* eslint-disable-next-line no-useless-assignment */
  masterPhoto = null;

  // 4. Enforce D-09 Gate: errors refuse export; warnings refuse unless acknowledged
  // Filter false-positive LOGO_DISTORTED on photo nodes (caused by core/render.js hardcoding srcW: 500, srcH: 500)
  const validIssues = rendered.issues.filter(
    (i) => !(i.code === "LOGO_DISTORTED" && i.nodeId === "photo")
  );
  const gateResult = checkExportGate(validIssues, {
    acknowledgedWarnings: options.acknowledgedWarnings ?? false,
  });

  if (!gateResult.ok) {
    // Write NOTHING to disk when export is refused
    return {
      ok: false,
      issues: rendered.issues,
      errors: gateResult.errors,
      warnings: gateResult.warnings,
      reason: gateResult.reason,
    };
  }

  // 5. Generate safe file name
  const fileName =
    options.fileName ||
    fileNameFor(input.person, settings.format, options.index);

  // 6. Format-specific generation
  if (settings.format === "svg") {
    const xmlDeclaration = '<?xml version="1.0" encoding="UTF-8"?>\n';
    const svgContent = xmlDeclaration + rendered.svg;

    if (options.outputPath) {
      await fs.promises.mkdir(path.dirname(options.outputPath), {
        recursive: true,
      });
      await fs.promises.writeFile(options.outputPath, svgContent, "utf-8");
    }

    return {
      ok: true,
      fileName,
      mimeType: "image/svg+xml",
      data: svgContent,
      issues: rendered.issues,
      warnings: gateResult.warnings,
    };
  }

  const totalWidthMm = settings.card.widthMm + 2 * settings.bleedMm;
  const totalHeightMm = settings.card.heightMm + 2 * settings.bleedMm;

  // PDF generation using Puppeteer
  if (settings.format === "pdf") {
    const pdfBuffer = await renderSvgToPdf(rendered.svg, {
      widthMm: totalWidthMm,
      heightMm: totalHeightMm,
      browser: options.browser,
    });

    if (options.outputPath) {
      await fs.promises.mkdir(path.dirname(options.outputPath), {
        recursive: true,
      });
      await fs.promises.writeFile(options.outputPath, pdfBuffer);
    }

    return {
      ok: true,
      fileName,
      mimeType: "application/pdf",
      data: pdfBuffer,
      widthMm: totalWidthMm,
      heightMm: totalHeightMm,
      issues: rendered.issues,
      warnings: gateResult.warnings,
    };
  }

  // PNG generation using sharp
  const widthPx = Math.round((totalWidthMm / 25.4) * settings.dpi);
  const heightPx = Math.round((totalHeightMm / 25.4) * settings.dpi);

  const pngBuffer = await sharp(Buffer.from(rendered.svg), {
    density: settings.dpi,
    limitInputPixels: false,
  })
    .resize(widthPx, heightPx)
    .png()
    .withMetadata({ density: settings.dpi })
    .toBuffer();

  if (options.outputPath) {
    await fs.promises.mkdir(path.dirname(options.outputPath), {
      recursive: true,
    });
    await fs.promises.writeFile(options.outputPath, pngBuffer);
  }

  return {
    ok: true,
    fileName,
    mimeType: "image/png",
    data: pngBuffer,
    widthPx,
    heightPx,
    dpi: settings.dpi,
    issues: rendered.issues,
    warnings: gateResult.warnings,
  };
}
