// @ts-check
import puppeteer from "puppeteer";

/**
 * Global shared browser instance when pooling across exports.
 * @type {import("puppeteer").Browser | null}
 */
let sharedBrowser = null;

/**
 * Launches a headless Chromium instance with security sandboxing, pipe transport,
 * and zero network access.
 *
 * @param {import("puppeteer").PuppeteerLaunchOptions} [extraOptions]
 * @returns {Promise<import("puppeteer").Browser>}
 */
export async function launchBrowser(extraOptions = {}) {
  const browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
    ...extraOptions,
  });

  return browser;
}

/**
 * Gets or lazily initializes the shared browser instance.
 * @returns {Promise<import("puppeteer").Browser>}
 */
export async function getSharedBrowser() {
  if (!sharedBrowser || !sharedBrowser.connected) {
    sharedBrowser = await launchBrowser();
  }
  return sharedBrowser;
}

/**
 * Closes the shared browser instance if open.
 */
export async function closeSharedBrowser() {
  if (sharedBrowser) {
    try {
      if (sharedBrowser.connected) {
        await sharedBrowser.close();
      }
    } catch {
      // Ignore cleanup error
    } finally {
      sharedBrowser = null;
    }
  }
}

/**
 * Executes an async action using a browser instance, guaranteeing that the browser
 * is closed in a finally block if this function launched it.
 *
 * If caller provides an existing browser instance via options, that browser is reused
 * and NOT closed here.
 *
 * @template T
 * @param {(browser: import("puppeteer").Browser) => Promise<T>} fn
 * @param {{ browser?: import("puppeteer").Browser }} [options]
 * @returns {Promise<T>}
 */
export async function withBrowser(fn, options = {}) {
  const ownsBrowser = !options.browser;
  const browser = options.browser || (await launchBrowser());

  try {
    return await fn(browser);
  } finally {
    if (ownsBrowser) {
      try {
        if (browser.connected) {
          await browser.close();
        }
      } catch {
        // Ignore cleanup error
      }
    }
  }
}

/**
 * Configures request interception on a Puppeteer page to block any network requests
 * that are not data: URLs or the page itself (about:blank).
 *
 * @param {import("puppeteer").Page} page
 */
export async function enforceOfflinePage(page) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url === "about:blank" || url.startsWith("data:")) {
      req.continue();
    } else {
      req.abort("blockedbyclient");
    }
  });
}

/**
 * Renders an SVG document into a print-ready vector PDF using Puppeteer.
 *
 * @param {string} svgContent - Complete SVG XML string
 * @param {{
 *   widthMm: number;
 *   heightMm: number;
 *   browser?: import("puppeteer").Browser;
 * }} options
 * @returns {Promise<Buffer>}
 */
export async function renderSvgToPdf(svgContent, options) {
  const { widthMm, heightMm, browser } = options;

  return withBrowser(
    async (b) => {
      const page = await b.newPage();
      try {
        await enforceOfflinePage(page);

        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>ID cards</title>
<style>
  @page {
    size: ${widthMm}mm ${heightMm}mm;
    margin: 0;
  }
  html, body {
    margin: 0;
    padding: 0;
    width: ${widthMm}mm;
    height: ${heightMm}mm;
    overflow: hidden;
  }
  svg {
    display: block;
    width: ${widthMm}mm;
    height: ${heightMm}mm;
  }
</style>
</head>
<body>
${svgContent}
</body>
</html>`;

        await page.setContent(html, { waitUntil: "load" });

        const pdfArray = await page.pdf({
          width: `${widthMm}mm`,
          height: `${heightMm}mm`,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
          printBackground: true,
          preferCSSPageSize: true,
        });

        return Buffer.from(pdfArray);
      } finally {
        await page.close().catch(() => {});
      }
    },
    { browser }
  );
}

/**
 * Renders an HTML document containing one or more print sheets into a vector PDF.
 *
 * @param {string} htmlContent - Complete HTML string (with @page styling)
 * @param {{
 *   widthMm: number;
 *   heightMm: number;
 *   browser?: import("puppeteer").Browser;
 * }} options
 * @returns {Promise<Buffer>}
 */
export async function renderHtmlToPdf(htmlContent, options) {
  const { widthMm, heightMm, browser } = options;

  return withBrowser(
    async (b) => {
      const page = await b.newPage();
      try {
        await enforceOfflinePage(page);

        await page.setContent(htmlContent, { waitUntil: "load" });

        const pdfArray = await page.pdf({
          width: `${widthMm}mm`,
          height: `${heightMm}mm`,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
          printBackground: true,
          preferCSSPageSize: true,
        });

        return Buffer.from(pdfArray);
      } finally {
        await page.close().catch(() => {});
      }
    },
    { browser }
  );
}

/**
 * Inspects a PDF byte buffer to determine page dimensions, page count, and absence
 * of embedded font objects without external PDF libraries.
 *
 * @param {Buffer | Uint8Array} pdfBuffer
 * @returns {{
 *   pageCount: number;
 *   mediaBoxes: Array<{ widthPt: number, heightPt: number, widthMm: number, heightMm: number }>;
 *   hasEmbeddedFonts: boolean;
 *   fontCount: number;
 *   imageCount: number;
 *   hasCreationDate: boolean;
 *   title: string | null;
 *   author: string | null;
 *   producer: string | null;
 * }}
 */
export function inspectPdfBytes(pdfBuffer) {
  const str = Buffer.from(pdfBuffer).toString("latin1");

  // Check for valid PDF header
  if (!str.startsWith("%PDF-")) {
    throw new Error("Invalid PDF: Missing %PDF- header");
  }

  // Detect pages
  const pageMatches = str.match(/\/Type\s*\/Page\b/g);
  const pageCount = pageMatches ? pageMatches.length : 0;

  // Extract all MediaBox definitions: /MediaBox [ 0 0 W H ]
  const mediaBoxRegex = /\/MediaBox\s*\[\s*([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s*\]/g;
  /** @type {Array<{ widthPt: number, heightPt: number, widthMm: number, heightMm: number }>} */
  const mediaBoxes = [];
  let match;
  while ((match = mediaBoxRegex.exec(str)) !== null) {
    const x1 = parseFloat(match[1]);
    const y1 = parseFloat(match[2]);
    const x2 = parseFloat(match[3]);
    const y2 = parseFloat(match[4]);
    const widthPt = Number((x2 - x1).toFixed(2));
    const heightPt = Number((y2 - y1).toFixed(2));
    const widthMm = Number(((widthPt * 25.4) / 72).toFixed(2));
    const heightMm = Number(((heightPt * 25.4) / 72).toFixed(2));
    mediaBoxes.push({ widthPt, heightPt, widthMm, heightMm });
  }

  // Check whether any embedded font dictionaries exist
  // When text is outlines (D-28), Skia/PDF does not create font objects.
  const fontMatches = str.match(/\/Type\s*\/Font\b/g);
  const fontCount = fontMatches ? fontMatches.length : 0;
  const hasEmbeddedFonts = fontCount > 0 || /\/Type\s*\/FontDescriptor\b/.test(str);

  // Check for /Subtype /Image XObjects
  const imageMatches = str.match(/\/Subtype\s*\/Image\b/g);
  const imageCount = imageMatches ? imageMatches.length : 0;

  // Check for CreationDate
  const hasCreationDate = /\/CreationDate\b/.test(str);

  // Extract metadata (Title, Author, Producer)
  const titleMatch = str.match(/\/Title\s*\(([^)]*)\)/);
  const title = titleMatch ? titleMatch[1] : null;

  const authorMatch = str.match(/\/Author\s*\(([^)]*)\)/);
  const author = authorMatch ? authorMatch[1] : null;

  const producerMatch = str.match(/\/Producer\s*\(([^)]*)\)/);
  const producer = producerMatch ? producerMatch[1] : null;

  return {
    pageCount,
    mediaBoxes,
    hasEmbeddedFonts,
    fontCount,
    imageCount,
    hasCreationDate,
    title,
    author,
    producer,
  };
}
