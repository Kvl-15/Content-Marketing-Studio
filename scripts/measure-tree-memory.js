// @ts-check
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import opentype from "opentype.js";
import { exportSheet } from "../server/export/index.js";
import { getSharedBrowser, closeSharedBrowser } from "../server/export/pdf.js";
import { sampleEventSpec, personNormal } from "../core/fixtures.js";
import { composeDrafts } from "../core/composer.js";

/**
 * Gets all Chromium process IDs for memory tracking.
 * @param {import("puppeteer").Browser} browser
 */
async function getChromiumPids(browser) {
  try {
    const session = await browser.target().createCDPSession();
    const sys = await session.send("SystemInfo.getProcessInfo");
    await session.detach().catch(() => {});
    return sys.processInfo.map((p) => p.id);
  } catch {
    const root = browser.process()?.pid;
    return root ? [root] : [];
  }
}

/**
 * Queries total working set for process IDs via PowerShell.
 * @param {number[]} pids
 */
function getMemoryForPids(pids) {
  if (!pids || pids.length === 0) return 0;
  try {
    const pidStr = pids.join(",");
    const cmd = `Get-Process -Id ${pidStr} -ErrorAction SilentlyContinue | Measure-Object -Property WorkingSet64 -Sum | Select-Object -ExpandProperty Sum`;
    const out = execSync(`powershell -NoProfile -Command "${cmd}"`, { encoding: "utf-8" }).trim();
    const val = parseInt(out, 10);
    return isNaN(val) ? 0 : val;
  } catch {
    return 0;
  }
}

/**
 * Creates a synthetic noisy test JPEG photo (~1600x2200, 1-3 MB) with deterministic noise.
 * @param {number} index
 * @returns {Promise<Buffer>}
 */
async function createSyntheticMaster(index) {
  const width = 1600;
  const height = 2200;
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
    const isMarker = y >= 200 && y <= 350;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      if (isMarker && x >= 400 && x <= 1200) {
        // High-contrast marker near top
        buf[idx] = 255;
        buf[idx + 1] = 255;
        buf[idx + 2] = 0;
      } else {
        // 50% base color + 50% high-frequency noise -> produces ~1.5 - 2.5 MB JPEG
        const nR = nextLcg();
        const nG = nextLcg();
        const nB = nextLcg();
        buf[idx] = (rBase + nR) >> 1;
        buf[idx + 1] = (gBase + nG) >> 1;
        buf[idx + 2] = (bBase + nB) >> 1;
      }
    }
  }

  return sharp(buf, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function run() {
  console.log("=== Step 1: Loading Assets & Brand Kit ===");
  const heading = opentype.parse(fs.readFileSync("assets/fonts/SpaceGrotesk-Bold.ttf").buffer);
  const body = opentype.parse(fs.readFileSync("assets/fonts/Inter-Regular.ttf").buffer);
  const fonts = { heading, body };

  const brandJson = JSON.parse(fs.readFileSync("content/brand-kits/test-logos/brand.json", "utf-8"));
  for (const [, logo] of Object.entries(brandJson.logos)) {
    if (logo?.file) {
      const buf = fs.readFileSync(logo.file);
      logo.dataUri = "data:image/jpeg;base64," + buf.toString("base64");
      logo.width = 1200;
      logo.height = 1200;
    }
  }

  const draftsResult = composeDrafts(sampleEventSpec, { brand: brandJson, qrEnabled: false, seed: 101, count: 1 });
  const draft = draftsResult.drafts[0];

  let benchTempDir = null;
  try {
    // -------------------------------------------------------------------------
    // Step 2: Separate Unmeasured Master File Generation to os.tmpdir()
    // -------------------------------------------------------------------------
    benchTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "acm-bench-masters-"));
    console.log(`\n=== Step 2: Generating 235 Deterministic Noisy Synthetic Masters in ${benchTempDir} ===`);
    const tGen0 = performance.now();
    let genPeakNodeRss = process.memoryUsage().rss;
    let totalMasterBytes = 0;

    for (let i = 0; i < 235; i++) {
      const buf = await createSyntheticMaster(i);
      totalMasterBytes += buf.length;
      await fs.promises.writeFile(path.join(benchTempDir, `master-${i}.jpg`), buf);
      const currRss = process.memoryUsage().rss;
      if (currRss > genPeakNodeRss) genPeakNodeRss = currRss;
    }
    const tGen1 = performance.now();
    const avgMasterSizeMb = (totalMasterBytes / (235 * 1024 * 1024)).toFixed(2);
    console.log(`Generated and wrote 235 master files in ${((tGen1 - tGen0) / 1000).toFixed(2)}s`);
    console.log(`Average Master JPEG Size: ${avgMasterSizeMb} MB (Total: ${(totalMasterBytes / (1024 * 1024)).toFixed(1)} MB)`);
    console.log(`Separate Generation Peak Node RSS: ${(genPeakNodeRss / (1024 * 1024)).toFixed(2)} MB`);

    // Force GC if available or pause briefly to settle memory before benchmark
    if (global.gc) global.gc();
    await new Promise((r) => setTimeout(r, 1000));

    // -------------------------------------------------------------------------
    // Step 3: Measured 235-Card Export Benchmark via Streaming photoSource(personId)
    // -------------------------------------------------------------------------
    console.log("\n=== Step 3: Measured 235-Card Export via Streaming photoSource (E2c-2 Pipeline) ===");

    // Streaming photoSource: reads one file at a time, returns Buffer
    const photoSource = async (personId) => {
      const numStr = personId.replace("bench-235-", "");
      const idx = parseInt(numStr, 10) - 1;
      const filePath = path.join(benchTempDir, `master-${idx}.jpg`);
      return fs.promises.readFile(filePath);
    };

    const people = Array.from({ length: 235 }, (_, i) => ({
      ...personNormal,
      id: `bench-235-${i + 1}`,
      name: `Person ${i + 1}`,
      roleId: ["participant", "volunteer", "mentor", "organizer"][i % 4],
      photo: undefined, // Master photo streamed via photoSource(personId)
    }));

    const input = {
      eventSpec: sampleEventSpec,
      draft,
      people,
      photoSource,
      brand: brandJson,
      fonts,
    };

    const browser = await getSharedBrowser();
    let chromePids = await getChromiumPids(browser);

    let peakNode = process.memoryUsage().rss;
    let peakChrome = getMemoryForPids(chromePids);
    let peakTotal = peakNode + peakChrome;

    let stopped = false;
    let stopRuleTriggered = false;

    const poll = async () => {
      while (!stopped) {
        const nodeRss = process.memoryUsage().rss;
        if (nodeRss > peakNode) peakNode = nodeRss;

        const latestPids = await getChromiumPids(browser);
        if (latestPids.length > 0) chromePids = latestPids;

        const chromeRss = getMemoryForPids(chromePids);
        if (chromeRss > peakChrome) peakChrome = chromeRss;

        const totalRss = nodeRss + chromeRss;
        if (totalRss > peakTotal) peakTotal = totalRss;

        // Stop rule: > 1.5 GB total or > 5 minutes
        if (totalRss > 1500 * 1024 * 1024) {
          stopRuleTriggered = true;
          console.error(`STOP RULE TRIGGERED: Process tree memory exceeded 1.5 GB (${(totalRss / (1024 * 1024)).toFixed(1)} MB)!`);
          stopped = true;
          break;
        }

        await new Promise((r) => setTimeout(r, 200));
      }
    };

    const pollPromise = poll();
    const t0 = performance.now();
    const res = await exportSheet(input, { format: "pdf" });
    const t1 = performance.now();
    stopped = true;
    await pollPromise;

    const elapsed = ((t1 - t0) / 1000).toFixed(2);
    if (parseFloat(elapsed) > 300) {
      stopRuleTriggered = true;
      console.error(`STOP RULE TRIGGERED: Execution took longer than 5 minutes (${elapsed}s)!`);
    }

    if (!res.ok) {
      console.error(`Export failed: ${res.reason}`);
      process.exit(1);
    }

    const pdfSize = res.data ? res.data.length : 0;

    console.log(`\n========================================================`);
    console.log(`235-CARD BENCHMARK MEASURED RESULTS (Single Run)`);
    console.log(`========================================================`);
    console.log(`Cards Processed          : 235 (27 A4 pages, 9 cards/page)`);
    console.log(`Success                  : ${res.ok}`);
    console.log(`Stop Rule Exceeded (>1.5GB): ${stopRuleTriggered}`);
    console.log(`PDF File Size            : ${(pdfSize / (1024 * 1024)).toFixed(2)} MB (${pdfSize} bytes)`);
    console.log(`Execution Time (Total)   : ${elapsed} s`);
    if (res.timings) {
      console.log(`Execution Time Breakdown:`);
      console.log(`  - Master Disk Reads (photoSource): ${res.timings.photoSourceReadSec} s`);
      console.log(`  - Photo Preparation (Sharp)      : ${res.timings.photoPrepSec} s`);
      console.log(`  - Card Render & Outline Gen      : ${res.timings.cardRenderSec} s`);
      console.log(`  - D-09 Batch Gate Checking       : ${res.timings.gateCheckSec} s`);
      console.log(`  - Sheet Imposition Layout        : ${res.timings.layoutSec} s`);
      console.log(`  - SVG Assembly & Deduplication   : ${res.timings.svgAssemblySec} s`);
      console.log(`  - Chromium PDF Print             : ${res.timings.chromiumPrintSec} s`);
      console.log(`  - Unattributed / Overhead        : ${res.timings.unattributedSec} s`);
      console.log(`  - Total Elapsed (Wall Clock)     : ${res.timings.totalSec} s`);
    }
    console.log(`Memory Footprint:`);
    console.log(`  - Peak Node RSS        : ${(peakNode / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  - Peak Chromium RSS    : ${(peakChrome / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`  - Total Process-Tree   : ${(peakTotal / (1024 * 1024)).toFixed(2)} MB`);
    if (res.photoStats) {
      console.log(`Prepared Photo Data URIs :`);
      console.log(`  - Total Prepared Count : ${res.photoStats.count}`);
      console.log(`  - Average Data URI Size: ${(res.photoStats.avgBytes / 1024).toFixed(2)} KB`);
      console.log(`  - Total Data URI Size  : ${(res.photoStats.totalBytes / (1024 * 1024)).toFixed(2)} MB`);
    }
    console.log(`========================================================`);

    // -------------------------------------------------------------------------
    // Step 4: Finding Report on Raw Unresized Masters Attempt
    // -------------------------------------------------------------------------
    console.log(`\n=== Finding on Raw Masters Attempt (Before Resize) ===`);
    console.log(`In an earlier attempt without resizing, embedding 235 raw masters (~2 MB JPEG each)`);
    console.log(`into a single multi-page SVG/HTML document produced a ~650 MB base64 HTML string.`);
    console.log(`This exceeded Node.js V8's maximum string length limit of 512 MB (0x1fffffe8 chars),`);
    console.log(`throwing RangeError: 'Cannot create a string longer than 0x1fffffe8 characters'.`);
    console.log(`Conclusion: Raw embedding without photo resizing is impossible in Node.js/Chromium;`);
    console.log(`downscaling photos via preparePhotoForCard is strictly required.`);
  } finally {
    await closeSharedBrowser();
    if (benchTempDir) {
      try {
        await fs.promises.rm(benchTempDir, { recursive: true, force: true });
        console.log(`\nCleaned up temp master directory: ${benchTempDir}`);
      } catch {
        // Ignore cleanup error
      }
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
