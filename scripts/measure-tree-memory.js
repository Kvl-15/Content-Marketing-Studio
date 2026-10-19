import { execSync } from "child_process";
import fs from "fs";
import opentype from "opentype.js";
import { exportSheet } from "../server/export/index.js";
import { getSharedBrowser, closeSharedBrowser } from "../server/export/pdf.js";
import { sampleEventSpec, personNormal } from "../core/fixtures.js";
import { composeDrafts } from "../core/composer.js";

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

async function run() {
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

  const drafts = composeDrafts(sampleEventSpec, { seed: 101, count: 1 });
  const draft = drafts[0];

  const people235 = Array.from({ length: 235 }, (_, i) => ({
    ...personNormal,
    id: `bench-235-${i + 1}`,
    roleId: ["participant", "volunteer", "mentor", "organizer"][i % 4],
  }));

  const input235 = {
    eventSpec: sampleEventSpec,
    draft,
    people: people235,
    brand: brandJson,
    fonts,
  };

  // Pre-warm browser so session is established
  const browser = await getSharedBrowser();
  let chromePids = await getChromiumPids(browser);

  let peakNodeRss = process.memoryUsage().rss;
  let peakChromeRss = getMemoryForPids(chromePids);
  let peakTotalRss = peakNodeRss + peakChromeRss;

  let stopped = false;
  const poll = async () => {
    while (!stopped) {
      const nodeRss = process.memoryUsage().rss;
      if (nodeRss > peakNodeRss) peakNodeRss = nodeRss;

      // Refresh Chrome PIDs periodically in case renderer spawned
      const latestPids = await getChromiumPids(browser);
      if (latestPids.length > 0) chromePids = latestPids;

      const chromeRss = getMemoryForPids(chromePids);
      if (chromeRss > peakChromeRss) peakChromeRss = chromeRss;

      const totalRss = nodeRss + chromeRss;
      if (totalRss > peakTotalRss) peakTotalRss = totalRss;

      await new Promise((r) => setTimeout(r, 300));
    }
  };

  const pollPromise = poll();

  const t0 = performance.now();
  const res = await exportSheet(input235, { format: "pdf" });
  const t1 = performance.now();

  stopped = true;
  await pollPromise;

  // Final measurement
  const finalNodeRss = process.memoryUsage().rss;
  if (finalNodeRss > peakNodeRss) peakNodeRss = finalNodeRss;
  const finalChromeRss = getMemoryForPids(chromePids);
  if (finalChromeRss > peakChromeRss) peakChromeRss = finalChromeRss;
  const finalTotal = peakNodeRss + peakChromeRss;
  if (finalTotal > peakTotalRss) peakTotalRss = finalTotal;

  await closeSharedBrowser();

  const elapsedSec = ((t1 - t0) / 1000).toFixed(2);
  const pdfSize = res.data.length;

  console.log("=== 235-CARD MEASUREMENT RUN ===");
  console.log(`Cards count: 235 cards (27 A4 sheet pages)`);
  console.log(`Execution time: ${elapsedSec} s`);
  console.log(`PDF file size: ${pdfSize} bytes (${(pdfSize / 1024).toFixed(1)} KB)`);
  console.log(`Peak Node RSS: ${(peakNodeRss / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Peak Chromium RSS (all child processes): ${(peakChromeRss / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Peak Total Process-Tree Memory: ${(peakTotalRss / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Had real raster photos: FALSE (used SVG silhouette avatar because person.photo was string path not data URI)`);
}

run().catch(console.error);
