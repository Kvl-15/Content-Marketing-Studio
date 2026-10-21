// @ts-check
import sharp from "sharp";

// Disable libvips operation cache and threadpool over-allocation to bound native memory
if (typeof sharp.cache === "function") {
  sharp.cache(false);
}
if (typeof sharp.concurrency === "function") {
  sharp.concurrency(1);
}

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
  // Use resolveWithObject: true to receive dimensions directly, eliminating redundant metadata re-parse
  const { data: outputBuffer, info } = await image
    .jpeg({
      quality,
      mozjpeg: false,
    })
    .toBuffer({ resolveWithObject: true });

  const finalWidth = info.width || targetPxW;
  const finalHeight = info.height || targetPxH;

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

/**
 * Creates a synthetic noisy test JPEG photo (~1600x2200, 1-3 MB) with deterministic noise,
 * a unique base hue, and a high-contrast burned-in marker patch at the computed crop center.
 *
 * @param {number} index - Index for deterministic hue and noise seed
 * @param {string} [markerText] - Text or digit to burn in (e.g. "1".."9")
 * @param {{ width?: number, height?: number }} [options]
 * @returns {Promise<Buffer>}
 */
export async function createSyntheticPhotoWithMarker(index, markerText, options = {}) {
  const width = options.width || 1600;
  const height = options.height || 2200;
  let state = (index * 7919 + 12345) >>> 0;
  function nextLcg() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 16) & 0xff;
  }

  // Unique base color per index cycling around 360 degrees
  const hue = (index * 137.5) % 360;
  const rBase = Math.round(128 + 100 * Math.cos((hue * Math.PI) / 180));
  const gBase = Math.round(128 + 100 * Math.cos(((hue + 120) * Math.PI) / 180));
  const bBase = Math.round(128 + 100 * Math.cos(((hue + 240) * Math.PI) / 180));

  const buf = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      const nR = nextLcg();
      const nG = nextLcg();
      const nB = nextLcg();
      buf[idx] = (rBase + nR) >> 1;
      buf[idx + 1] = (gBase + nG) >> 1;
      buf[idx + 2] = (bBase + nB) >> 1;
    }
  }

  // Center of the 0.20 top-biased square crop:
  // For 1600x2200 master into 1:1 box: cropHeight = 1600, slackH = 600.
  // cropTop = 600 * 0.30 = 180. Center is (800, 180 + 800) = (800, 980).
  const char = markerText !== undefined ? String(markerText) : String(index + 1);
  const overlaySvg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="800" cy="980" r="160" fill="#111827" stroke="#FFFFFF" stroke-width="8" />
      <text x="800" y="1045" font-family="sans-serif" font-size="180" font-weight="bold" text-anchor="middle" fill="#FFFFFF">${char}</text>
    </svg>
  `);

  return sharp(buf, { raw: { width, height, channels: 3 } })
    .composite([{ input: overlaySvg }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
