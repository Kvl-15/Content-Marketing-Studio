// @ts-check
import { z } from "zod";

/**
 * Typed error thrown when export settings fail validation.
 */
export class ExportSettingsError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   */
  constructor(message, code = "INVALID_EXPORT_SETTINGS") {
    super(message);
    this.name = "ExportSettingsError";
    this.code = code;
  }
}

/** Standard sheet sizes in millimeters (width x height in portrait). */
export const PAPER_SIZES = Object.freeze({
  A4: { widthMm: 210, heightMm: 297 },
  A3: { widthMm: 297, heightMm: 420 },
});

/**
 * Card dimensions schema (CR80 standard default: 54 x 85.6 mm).
 */
export const CardSizeSchema = z
  .object({
    widthMm: z.number().finite("card.widthMm must be finite").positive("card.widthMm must be positive and non-zero"),
    heightMm: z.number().finite("card.heightMm must be finite").positive("card.heightMm must be positive and non-zero"),
  })
  .strict();

/**
 * Sheet configuration schema.
 */
export const SheetSettingsSchema = z
  .object({
    paper: z.enum(["A4", "A3", "custom"]),
    widthMm: z.number().finite("sheet.widthMm must be finite").positive("sheet.widthMm must be positive and non-zero").optional(),
    heightMm: z.number().finite("sheet.heightMm must be finite").positive("sheet.heightMm must be positive and non-zero").optional(),
    marginMm: z.number().finite("sheet.marginMm must be finite").min(0, "sheet.marginMm cannot be negative").default(5),
    gapMm: z.number().finite("sheet.gapMm must be finite").min(0, "sheet.gapMm cannot be negative").default(4),
    markLengthMm: z.number().finite("sheet.markLengthMm must be finite").positive("sheet.markLengthMm must be positive").default(2),
    markOffsetMm: z.number().finite("sheet.markOffsetMm must be finite").min(0, "sheet.markOffsetMm cannot be negative").default(3),
    markStrokeMm: z.number().finite("sheet.markStrokeMm must be finite").min(0.3, "sheet.markStrokeMm must be at least 0.3mm (print-safe)").default(0.35),
    printerSafeMm: z.number().finite("sheet.printerSafeMm must be finite").min(0, "sheet.printerSafeMm cannot be negative").max(20, "sheet.printerSafeMm cannot exceed 20mm").default(5),
    duplexFlip: z.enum(["long", "short"]).optional(),
  })
  .strict();

/**
 * Raw ExportSettings Zod schema before applying defaults and cross-field logic.
 */
export const ExportSettingsSchema = z
  .object({
    format: z.enum(["svg", "pdf", "png"]).default("pdf"),
    mode: z.enum(["single", "all", "sheets"]).default("sheets"),
    card: CardSizeSchema.default({ widthMm: 54, heightMm: 85.6 }),
    orientation: z.enum(["portrait", "landscape"]).default("portrait"),
    dpi: z.number().int("dpi must be an integer").min(72, "dpi must be at least 72").max(1200, "dpi cannot exceed 1200").default(300),
    bleedMm: z.number().finite("bleedMm must be finite").min(0, "bleedMm cannot be negative").max(10, "bleedMm cannot exceed 10mm").default(3),
    cropMarks: z.boolean().optional(),
    sides: z.enum(["front", "back", "both"]).default("front"),
    textAsOutlines: z.boolean().default(true),
    groupByRole: z.boolean().default(false),
    duplexFlip: z.enum(["long", "short"]).default("long"),
    printerSafeMm: z.number().finite("printerSafeMm must be finite").min(0, "printerSafeMm cannot be negative").max(20, "printerSafeMm cannot exceed 20mm").optional(),
    sheet: SheetSettingsSchema.default({
      paper: "A4",
      marginMm: 5,
      gapMm: 4,
      markLengthMm: 2,
      markOffsetMm: 3,
      markStrokeMm: 0.35,
      printerSafeMm: 5,
    }),
  })
  .strict();

/**
 * ExportSettings type definition.
 * @typedef {z.infer<typeof ExportSettingsSchema> & {
 *   cropMarks: boolean;
 *   duplexFlip: "long" | "short";
 *   printerSafeMm: number;
 *   sheet: {
 *     paper: "A4" | "A3" | "custom";
 *     widthMm: number;
 *     heightMm: number;
 *     marginMm: number;
 *     gapMm: number;
 *     markLengthMm: number;
 *     markOffsetMm: number;
 *     markStrokeMm: number;
 *     printerSafeMm: number;
 *     duplexFlip?: "long" | "short";
 *   }
 * }} ExportSettings
 */

/**
 * Parses and validates an export settings input object, applying defaults
 * and verifying paper dimensions and orientation swaps.
 *
 * @param {unknown} input - Raw settings input.
 * @returns {ExportSettings} Validated and normalized ExportSettings object.
 * @throws {ExportSettingsError} If validation fails or extra keys exist.
 */
export function parseExportSettings(input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ExportSettingsError("Export settings input must be an object", "INVALID_INPUT_TYPE");
  }

  /** @type {any} */
  let rawParsed;
  try {
    rawParsed = ExportSettingsSchema.parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issue = err.issues[0];
      const path = issue.path.length > 0 ? issue.path.join(".") : "root";
      throw new ExportSettingsError(`ExportSettings validation error at '${path}': ${issue.message}`, "SCHEMA_VALIDATION_ERROR");
    }
    throw new ExportSettingsError(String(err));
  }

  // 1. Resolve cropMarks default: true when mode is "sheets", false otherwise.
  const cropMarks = rawParsed.cropMarks !== undefined ? rawParsed.cropMarks : rawParsed.mode === "sheets";

  // 2. Resolve orientation and swap card dimensions if necessary.
  let cardWidth = rawParsed.card.widthMm;
  let cardHeight = rawParsed.card.heightMm;
  if (rawParsed.orientation === "landscape" && cardWidth < cardHeight) {
    const temp = cardWidth;
    cardWidth = cardHeight;
    cardHeight = temp;
  } else if (rawParsed.orientation === "portrait" && cardWidth > cardHeight) {
    const temp = cardWidth;
    cardWidth = cardHeight;
    cardHeight = temp;
  }

  // 3. Resolve sheet paper dimensions.
  const paper = rawParsed.sheet.paper;
  let sheetWidth;
  let sheetHeight;

  if (paper === "A4") {
    sheetWidth = PAPER_SIZES.A4.widthMm;
    sheetHeight = PAPER_SIZES.A4.heightMm;
  } else if (paper === "A3") {
    sheetWidth = PAPER_SIZES.A3.widthMm;
    sheetHeight = PAPER_SIZES.A3.heightMm;
  } else if (paper === "custom") {
    if (typeof rawParsed.sheet.widthMm !== "number" || typeof rawParsed.sheet.heightMm !== "number") {
      throw new ExportSettingsError(
        "Custom paper requires both 'widthMm' and 'heightMm' to be specified as positive numbers",
        "MISSING_CUSTOM_DIMENSIONS"
      );
    }
    sheetWidth = rawParsed.sheet.widthMm;
    sheetHeight = rawParsed.sheet.heightMm;
  } else {
    throw new ExportSettingsError(`Unknown paper type: ${paper}`, "UNKNOWN_PAPER");
  }

  // 4. Resolve printerSafeMm and duplexFlip
  const printerSafeMm = rawParsed.printerSafeMm !== undefined ? rawParsed.printerSafeMm : rawParsed.sheet.printerSafeMm;
  const duplexFlip = rawParsed.duplexFlip !== undefined ? rawParsed.duplexFlip : (rawParsed.sheet.duplexFlip || "long");

  return {
    ...rawParsed,
    card: {
      widthMm: cardWidth,
      heightMm: cardHeight,
    },
    cropMarks,
    duplexFlip,
    printerSafeMm,
    sheet: {
      ...rawParsed.sheet,
      widthMm: sheetWidth,
      heightMm: sheetHeight,
      printerSafeMm,
      duplexFlip,
    },
  };
}
