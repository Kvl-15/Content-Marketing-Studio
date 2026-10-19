// @ts-check
import QRCode from "qrcode";

/**
 * Generates pure vector SVG path data for a QR code from a target URL.
 *
 * Requirements:
 * - Deterministic output.
 * - HTTPS only: rejects non-string, invalid, or non-HTTPS URLs with clear errors.
 * - Returns vector path data and the module count (grid dimension).
 * - No external font or rendering dependencies.
 *
 * @param {string} url - Target URL (must start with https://)
 * @param {{
 *   errorCorrectionLevel?: "L" | "M" | "Q" | "H";
 *   margin?: number;
 * }} [options]
 * @returns {{
 *   path: string;
 *   d: string;
 *   modules: number;
 *   gridSize: number;
 *   margin: number;
 * }}
 */
export function qrPath(url, options = {}) {
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("QR URL must be a non-empty string");
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL for QR code: "${url}"`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `HTTPS only: QR code target must use https:// protocol, got "${parsed.protocol}"`
    );
  }

  const errorCorrectionLevel = options.errorCorrectionLevel || "M";
  const validEC = ["L", "M", "Q", "H"];
  if (!validEC.includes(errorCorrectionLevel)) {
    throw new Error(
      `Invalid errorCorrectionLevel: "${errorCorrectionLevel}". Must be one of: ${validEC.join(", ")}`
    );
  }

  const qr = QRCode.create(url, { errorCorrectionLevel });
  const size = qr.modules.size;
  const margin =
    Number.isInteger(options.margin) && options.margin >= 0
      ? options.margin
      : 0;

  // Build SVG path data using horizontal runs of 1x1 modules (crisp vector rects)
  let path = "";
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (qr.modules.get(r, c)) {
        const start = c;
        while (c < size && qr.modules.get(r, c)) {
          c++;
        }
        const runLen = c - start;
        const x = start + margin;
        const y = r + margin;
        path += `M${x} ${y}h${runLen}v1h-${runLen}Z`;
      } else {
        c++;
      }
    }
  }

  return {
    path,
    d: path,
    modules: size + 2 * margin,
    gridSize: size,
    margin,
  };
}
