// @ts-check
import sharp from "sharp";

/**
 * @typedef {{
 *   boxWmm: number;
 *   boxHmm: number;
 *   dpi?: number;
 *   quality?: number;
 *   topBias?: number;
 *   limitInputPixels?: number;
 *   personId?: string;
 * }} PhotoPrepOptions
 *
 * @typedef {{
 *   dataUri: string;
 *   width: number;
 *   height: number;
 *   effectiveDpi: number;
 * }} PhotoPrepResult
 */

/**
 * Error class for photo preparation failures, ensuring privacy
 * (no participant names, emails, or raw photo data in error messages).
 */
export class PhotoPrepError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {string} [personId]
   */
  constructor(message, code, personId) {
    super(personId ? `[Person ${personId}] ${code}: ${message}` : `${code}: ${message}`);
    this.name = "PhotoPrepError";
    this.code = code;
    this.personId = personId;
  }
}

/**
 * Extracts raw binary buffer from a data URI or Buffer/Uint8Array.
 * Rejects path strings (e.g. "uploads/x.jpg") that are not data URIs.
 *
 * @param {Buffer | Uint8Array | string} input
 * @param {string} [personId]
 * @returns {Buffer}
 */
export function extractImageBuffer(input, personId) {
  if (!input) {
    throw new PhotoPrepError("Photo buffer is empty or missing", "EMPTY_PHOTO_DATA", personId);
  }

  if (Buffer.isBuffer(input)) {
    if (input.length === 0) {
      throw new PhotoPrepError("Photo buffer is zero bytes", "EMPTY_PHOTO_DATA", personId);
    }
    return input;
  }

  if (input instanceof Uint8Array) {
    if (input.byteLength === 0) {
      throw new PhotoPrepError("Photo buffer is zero bytes", "EMPTY_PHOTO_DATA", personId);
    }
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed.startsWith("data:image/")) {
      throw new PhotoPrepError(
        `Photo is not a data URI (received file path or unsupported format)`,
        "NOT_A_DATA_URI",
        personId
      );
    }
    const commaIndex = trimmed.indexOf(",");
    if (commaIndex === -1) {
      throw new PhotoPrepError("Malformed image data URI (missing comma)", "INVALID_PHOTO_DATA", personId);
    }
    const base64Data = trimmed.slice(commaIndex + 1);
    const buf = Buffer.from(base64Data, "base64");
    if (buf.length === 0) {
      throw new PhotoPrepError("Photo data URI contains zero bytes", "EMPTY_PHOTO_DATA", personId);
    }
    return buf;
  }

  throw new PhotoPrepError("Unsupported photo input type", "INVALID_PHOTO_DATA", personId);
}

/**
 * Finds the photo element box in a rendered card scene.
 *
 * @param {Array<{ id?: string, type?: string, box?: { x: number, y: number, w: number, h: number } }>} scene
 * @returns {{ x: number, y: number, w: number, h: number } | null}
 */
export function extractPhotoBoxFromScene(scene) {
  if (!Array.isArray(scene)) return null;
  const node = scene.find((n) => (n.type === "image" || n.type === "rect") && n.id === "photo");
  return node?.box || null;
}

/**
 * Prepares a person photo for placement on a card:
 * 1. Validates image bytes with sharp (limitInputPixels, corrupt bytes check).
 * 2. Never stretches: cover-crops with top bias (0.20 toward the top) if aspect ratio differs.
 * 3. Never upscales: resizes without enlargement to target box dimensions (boxMm / 25.4 * dpi).
 * 4. Flattens transparent PNGs onto white (#FFFFFF).
 * 5. Converts CMYK/Grayscale to sRGB.
 * 6. Strips EXIF/metadata.
 * 7. Encodes as JPEG quality 90 and returns a deterministic data URI.
 *
 * @param {Buffer | Uint8Array | string} input
 * @param {PhotoPrepOptions} options
 * @returns {Promise<PhotoPrepResult>}
 */
export async function preparePhotoForCard(input, options) {
  const {
    boxWmm,
    boxHmm,
    dpi = 300,
    quality = 90,
    topBias = 0.20,
    limitInputPixels = 50_000_000,
    personId,
  } = options;

  if (typeof boxWmm !== "number" || boxWmm <= 0 || !Number.isFinite(boxWmm)) {
    throw new PhotoPrepError("boxWmm must be a positive finite number", "INVALID_OPTIONS", personId);
  }
  if (typeof boxHmm !== "number" || boxHmm <= 0 || !Number.isFinite(boxHmm)) {
    throw new PhotoPrepError("boxHmm must be a positive finite number", "INVALID_OPTIONS", personId);
  }

  const buf = extractImageBuffer(input, personId);

  /** @type {sharp.Sharp} */
  let image;
  /** @type {sharp.Metadata} */
  let meta;

  try {
    image = sharp(buf, { limitInputPixels, failOn: "error" });
    meta = await image.metadata();
  } catch (err) {
    const msg = /** @type {Error} */ (err).message || "";
    if (msg.includes("pixel limit") || msg.includes("limitInputPixels")) {
      throw new PhotoPrepError("Photo exceeds pixel limit", "PHOTO_EXCEEDS_PIXEL_LIMIT", personId);
    }
    throw new PhotoPrepError("Photo image file is corrupt or unreadable", "CORRUPT_PHOTO", personId);
  }

  if (!meta.width || !meta.height) {
    throw new PhotoPrepError("Photo has invalid zero dimensions", "INVALID_PHOTO_DATA", personId);
  }

  // 1. Flatten transparency on white background (e.g. PNG / WebP with alpha)
  if (meta.hasAlpha || meta.format === "png" || meta.format === "webp") {
    image = image.flatten({ background: "#FFFFFF" });
  }

  // 2. Ensure sRGB colour space (converts CMYK or Grayscale)
  image = image.toColorspace("srgb");

  // 3. Aspect ratio calculation & top-biased cover crop
  const targetRatio = boxWmm / boxHmm;
  const srcRatio = meta.width / meta.height;

  if (Math.abs(srcRatio - targetRatio) > 0.001) {
    let cropWidth;
    let cropHeight;
    let cropLeft;
    let cropTop;
    if (srcRatio < targetRatio) {
      // Source is taller than target -> crop vertical excess with top bias
      cropWidth = meta.width;
      cropHeight = Math.min(meta.height, Math.round(meta.width / targetRatio));
      const slackH = meta.height - cropHeight;
      // Center crop would be slackH * 0.50; topBias shifts 0.20 toward top (offset: slackH * 0.30)
      const topOffsetRatio = Math.max(0, 0.50 - topBias);
      cropTop = Math.max(0, Math.min(slackH, Math.round(slackH * topOffsetRatio)));
      cropLeft = 0;
    } else {
      // Source is wider than target -> crop horizontal excess centered
      cropHeight = meta.height;
      cropWidth = Math.min(meta.width, Math.round(meta.height * targetRatio));
      const slackW = meta.width - cropWidth;
      cropLeft = Math.max(0, Math.min(slackW, Math.round(slackW * 0.50)));
      cropTop = 0;
    }

    image = image.extract({
      left: cropLeft,
      top: cropTop,
      width: cropWidth,
      height: cropHeight,
    });
  }

  // 4. Target pixel dimensions for card box at target DPI
  const targetPxW = Math.round((boxWmm / 25.4) * dpi);
  const targetPxH = Math.round((boxHmm / 25.4) * dpi);

  // Resize never upscales: withoutEnlargement: true
  image = image.resize({
    width: targetPxW,
    height: targetPxH,
    fit: "cover",
    withoutEnlargement: true,
  });

  // 5. Encode as JPEG quality 90, strip metadata (no withMetadata call)
  const outputBuffer = await image
    .jpeg({
      quality,
      mozjpeg: false,
    })
    .toBuffer();

  // Read back final output dimensions
  const finalMeta = await sharp(outputBuffer).metadata();
  const finalWidth = finalMeta.width || targetPxW;
  const finalHeight = finalMeta.height || targetPxH;

  // Effective DPI calculation (actual pixels per inch at card box size)
  const effDpiX = finalWidth / (boxWmm / 25.4);
  const effDpiY = finalHeight / (boxHmm / 25.4);
  const effectiveDpi = Number(Math.min(effDpiX, effDpiY).toFixed(1));

  const dataUri = `data:image/jpeg;base64,${outputBuffer.toString("base64")}`;

  return {
    dataUri,
    width: finalWidth,
    height: finalHeight,
    effectiveDpi,
  };
}
