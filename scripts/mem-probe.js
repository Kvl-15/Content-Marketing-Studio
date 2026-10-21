// @ts-check
/**
 * scripts/mem-probe.js
 * Temporary memory probe script for TASK M1.
 * Measures process.memoryUsage() at each export stage for 215 attendees with photos.
 * Does not modify any existing source code.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import sharp from "sharp";
import { loadServerAssets } from "../server/assets.js";
import { sampleEventSpec } from "../core/fixtures.js";
import { composeDrafts } from "../core/composer.js";
import { parseExportSettings } from "../core/exportSettings.js";
import { sheetLayout } from "../core/sheet.js";
import { renderCard } from "../core/render.js";
import {
  preparePhotoForCard,
  extractPhotoBoxFromScene,
} from "../server/export/photoPrep.js";
import {
  prefixCardSvgIds,
  deduplicateLogoInSvg,
} from "../server/export/exportSheet.js";
import {
  launchBrowser,
  enforceOfflinePage,
} from "../server/export/pdf.js";
import { checkExportGate } from "../server/export/gate.js";
import { exportSheet } from "../server/export/exportSheet.js";

// Helper to format memory numbers
function fmtMb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

function printMem(label, mem, baseMem = null) {
  const pad = 24;
  const l = label.padEnd(pad);
  const rss = `${fmtMb(mem.rss).padStart(8)} MB`;
  const heap = `${fmtMb(mem.heapUsed).padStart(8)} MB`;
  const ext = `${fmtMb(mem.external).padStart(8)} MB`;
  const ab = `${fmtMb(mem.arrayBuffers).padStart(8)} MB`;
  let diff = "";
  if (baseMem) {
    const diffRss = fmtMb(mem.rss - baseMem.rss);
    const diffHeap = fmtMb(mem.heapUsed - baseMem.heapUsed);
    diff = ` | diff: RSS ${diffRss >= "0" ? "+" : ""}${diffRss} MB, Heap ${diffHeap >= "0" ? "+" : ""}${diffHeap} MB`;
  }
  console.log(`${l} | RSS: ${rss} | HeapUsed: ${heap} | Ext: ${ext} | ArrayBuf: ${ab}${diff}`);
}

function getChromiumTreeMemory(pid) {
  if (!pid) return { rssBytes: 0, rssMb: "0.00", processCount: 0 };
  try {
    const cmd = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq ${pid} -or $_.ParentProcessId -eq ${pid} } | Measure-Object -Property WorkingSetSize -Sum | Select-Object -ExpandProperty Sum`;
    const countCmd = `(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq ${pid} -or $_.ParentProcessId -eq ${pid} }).Count`;
    const rawSum = execSync(`powershell -NoProfile -Command "${cmd}"`, { timeout: 10000 }).toString().trim();
    const rawCount = execSync(`powershell -NoProfile -Command "${countCmd}"`, { timeout: 10000 }).toString().trim();
    const sum = Number(rawSum) || 0;
    const count = Number(rawCount) || 1;
    return {
      rssBytes: sum,
      rssMb: (sum / 1024 / 1024).toFixed(2),
      processCount: count,
    };
  } catch (err) {
    return { rssBytes: 0, rssMb: "unknown", processCount: 0, error: err.message };
  }
}

async function main() {
  console.log("================================================================================");
  console.log("TASK M1: Memory Probe (215 Attendees with Photos Print-Sheet Export)");
  console.log("================================================================================");

  // STAGE 0: Node Idle
  const mIdle = process.memoryUsage();
  printMem("0. Node idle", mIdle);

  // STAGE 1: After Load (Fonts, Brand Kit, Draft Composition, 215 Photos on Disk)
  const assets = loadServerAssets();
  const draftResult = composeDrafts(sampleEventSpec, { seed: 1 });
  // Choose draft with photo slot (archetype: hero-photo-top or colour-block-split)
  const selectedDraft = draftResult.drafts.find((d) => d.archetype === "hero-photo-top") || draftResult.drafts[0];

  const tempDir = path.join(os.tmpdir(), `acm-studio-mem-probe-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  console.log(`[setup] Generating 215 realistic master test photos in ${tempDir}...`);
  // Generate 8 distinct 1600x2200 realistic noisy photo buffers (~1.8 MB each)
  const masterTemplates = [];
  for (let t = 0; t < 8; t++) {
    const noise = Buffer.alloc(800 * 1100 * 3);
    for (let i = 0; i < noise.length; i++) {
      noise[i] = ((i * 37 + t * 59) ^ (i >> 3)) & 0xff;
    }
    const buf = await sharp(noise, { raw: { width: 800, height: 1100, channels: 3 } })
      .resize(1600, 2200)
      .jpeg({ quality: 85 })
      .toBuffer();
    masterTemplates.push(buf);
  }

  const roles = ["participant", "mentor", "organizer", "volunteer"];
  const people = [];
  for (let i = 1; i <= 215; i++) {
    const pid = `HX26-P-${String(i).padStart(3, "0")}`;
    const filename = `${pid}.jpg`;
    const filePath = path.join(tempDir, filename);
    await fs.writeFile(filePath, masterTemplates[(i - 1) % masterTemplates.length]);
    people.push({
      id: pid,
      name: `Attendee Name ${i}`,
      roleId: roles[(i - 1) % roles.length],
      org: `SVNIT Department ${((i - 1) % 5) + 1}`,
      photo: filePath,
    });
  }

  // Clear master template buffers from memory so only disk files exist
  masterTemplates.length = 0;

  const mAfterLoad = process.memoryUsage();
  printMem("1. After load", mAfterLoad, mIdle);

  // PhotoSource provider reading from disk on demand
  const photoSource = async (personId) => {
    const p = people.find((x) => x.id === personId);
    if (!p || !p.photo) return null;
    return fs.readFile(p.photo);
  };

  const settings = parseExportSettings({
    format: "pdf",
    mode: "sheets",
    sheet: { paper: "A4" },
    dpi: 300,
  });

  // STAGE 2: After SVG Build (Photo Prep & Card SVGs)
  console.log("[probe] Executing Phase 1: Sequential Photo Prep & Card SVG Rendering for 215 cards...");
  const cardRenders = [];
  const cardMap = new Map();
  const draftPhotoBoxCache = new Map();
  let totalPreparedBytes = 0;

  for (let idx = 0; idx < people.length; idx++) {
    const person = people[idx];
    const pid = person.id;
    const draftKey = selectedDraft?.look?.id || selectedDraft?.skeleton || "default";
    let assumedBox = draftPhotoBoxCache.get(draftKey);
    const fallbackRoleId = sampleEventSpec.roles?.[0]?.id || "participant";

    if (!assumedBox && selectedDraft) {
      const dry = renderCard({
        skeleton: selectedDraft.skeleton,
        blocks: selectedDraft.blocks,
        theme: selectedDraft.theme,
        look: selectedDraft.look,
        person: { id: "dry-run", name: "Sample Person", roleId: fallbackRoleId },
        brand: assets.brandKit,
        fonts: assets.fonts,
        event: sampleEventSpec,
        card: {
          widthMm: settings.card.widthMm,
          heightMm: settings.card.heightMm,
          orientation: settings.orientation,
        },
        bleedMm: settings.bleedMm,
      });
      assumedBox = extractPhotoBoxFromScene(dry.scene);
      if (assumedBox) draftPhotoBoxCache.set(draftKey, assumedBox);
    }

    let masterPhoto = await photoSource(pid);
    let preparedPhotoUri = null;

    if (masterPhoto && assumedBox) {
      const prep = await preparePhotoForCard(masterPhoto, {
        boxWmm: assumedBox.w,
        boxHmm: assumedBox.h,
        dpi: settings.dpi,
        personId: pid,
      });
      preparedPhotoUri = prep.dataUri;
      totalPreparedBytes += prep.dataUri.length;
    }
    masterPhoto = null; // Released immediately

    const effectivePerson = { ...person, photo: preparedPhotoUri };
    const rendered = renderCard({
      skeleton: selectedDraft.skeleton,
      blocks: selectedDraft.blocks,
      theme: selectedDraft.theme,
      look: selectedDraft.look,
      person: effectivePerson,
      brand: assets.brandKit,
      fonts: assets.fonts,
      event: sampleEventSpec,
      card: {
        widthMm: settings.card.widthMm,
        heightMm: settings.card.heightMm,
        orientation: settings.orientation,
      },
      bleedMm: settings.bleedMm,
    });

    const cardItem = { person: effectivePerson, rendered, draft: selectedDraft };
    cardRenders.push(cardItem);
    cardMap.set(pid, cardItem);
  }

  const mAfterSvg = process.memoryUsage();
  printMem("2. After SVG build", mAfterSvg, mAfterLoad);
  console.log(`   (Prepared ${people.length} photos: total base64 strings = ${fmtMb(totalPreparedBytes)} MB, avg = ${(totalPreparedBytes / people.length / 1024).toFixed(1)} KB/photo)`);

  // STAGE 3: After HTML Build (Sheet SVGs & Full HTML Document)
  console.log("[probe] Executing Phase 2 & 3: Sheet Imposition & Full HTML Document Assembly...");
  const layoutCardItems = people.map((p) => ({
    id: p.id,
    role: p.roleId,
  }));
  const layoutResult = sheetLayout(settings, layoutCardItems);

  const brandLogos = [];
  if (assets.brandKit?.logos) {
    for (const [key, logo] of Object.entries(assets.brandKit.logos)) {
      if (logo && logo.dataUri) {
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
  const sharedDefIds = new Set(brandLogos.map((l) => l.defId));
  const sheetW = settings.sheet.widthMm;
  const sheetH = settings.sheet.heightMm;
  const pageSvgs = [];

  for (const page of layoutResult.pages) {
    let pageContent = "";
    let defsContent = "";
    for (const logo of brandLogos) {
      defsContent += `<svg id="${logo.defId}" viewBox="0 0 ${logo.width} ${logo.height}"><image width="${logo.width}" height="${logo.height}" href="${logo.dataUri}"/></svg>\n`;
    }
    pageContent += `<defs>\n${defsContent}</defs>\n`;

    for (let cellIdx = 0; cellIdx < page.cells.length; cellIdx++) {
      const cell = page.cells[cellIdx];
      const cardData = cardMap.get(cell.cardId);
      if (!cardData) continue;

      let cardSvg = cardData.rendered.svg;
      const vbMatch = cardSvg.match(/viewBox="([^"]+)"/);
      const viewBox = vbMatch ? vbMatch[1] : `-3 -3 ${cell.bleedBox.w} ${cell.bleedBox.h}`;
      const innerStart = cardSvg.indexOf(">") + 1;
      const innerEnd = cardSvg.lastIndexOf("</svg>");
      let innerSvg = innerStart > 0 && innerEnd > innerStart ? cardSvg.slice(innerStart, innerEnd) : cardSvg;

      for (const logo of brandLogos) {
        const { result } = deduplicateLogoInSvg(innerSvg, logo.dataUri, logo.defId);
        innerSvg = result;
      }

      const cardPrefix = `p${page.pageIndex}_c${cellIdx}_`;
      const isolatedInnerSvg = prefixCardSvgIds(innerSvg, cardPrefix, sharedDefIds);
      pageContent += `<svg x="${cell.bleedBox.x}" y="${cell.bleedBox.y}" width="${cell.bleedBox.w}" height="${cell.bleedBox.h}" viewBox="${viewBox}">\n${isolatedInnerSvg}\n</svg>\n`;
    }

    if (page.marks && page.marks.length > 0) {
      pageContent += `<g id="p${page.pageIndex}_crop-marks">\n`;
      for (const m of page.marks) {
        pageContent += `<line x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}" stroke="#000000" stroke-width="${m.strokeMm}" shape-rendering="crispEdges"/>\n`;
      }
      pageContent += `</g>\n`;
    }

    const sheetSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}mm" height="${sheetH}mm" viewBox="0 0 ${sheetW} ${sheetH}">\n${pageContent}</svg>`;
    pageSvgs.push(sheetSvg);
  }

  const htmlPages = pageSvgs.map((svg) => `  <div class="sheet-page">\n${svg}\n  </div>`).join("\n");
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>ID cards</title>
<style>
  @page { size: ${sheetW}mm ${sheetH}mm; margin: 0; }
  html, body { margin: 0; padding: 0; }
  .sheet-page { width: ${sheetW}mm; height: ${sheetH}mm; page-break-after: always; break-after: page; box-sizing: border-box; overflow: hidden; }
  .sheet-page:last-child { page-break-after: avoid; break-after: avoid; }
  svg { display: block; width: ${sheetW}mm; height: ${sheetH}mm; }
</style>
</head>
<body>
${htmlPages}
</body>
</html>`;

  const mAfterHtml = process.memoryUsage();
  printMem("3. After HTML build", mAfterHtml, mAfterSvg);
  console.log(`   (Generated ${layoutResult.pages.length} pages: fullHtml string length = ${fullHtml.length} chars, ~${fmtMb(Buffer.byteLength(fullHtml, "utf8"))} MB)`);

  // STAGE 4: Before Chromium
  console.log("[probe] Launching Chromium browser...");
  const browser = await launchBrowser();
  const rootPid = browser.process()?.pid;
  const page = await browser.newPage();
  await enforceOfflinePage(page);

  const mBeforeChromium = process.memoryUsage();
  const chromeBefore = getChromiumTreeMemory(rootPid);
  printMem("4. Before Chromium", mBeforeChromium, mAfterHtml);
  console.log(`   (Chromium root PID: ${rootPid}, initial tree working set: ${chromeBefore.rssMb} MB across ${chromeBefore.processCount} processes)`);

  // STAGE 5: After Chromium (page.setContent & page.pdf)
  console.log("[probe] Sending fullHtml via page.setContent() and rendering PDF via page.pdf()...");
  const tSetContent0 = performance.now();
  await page.setContent(fullHtml, { waitUntil: "load" });
  const tSetContent = performance.now() - tSetContent0;

  const chromeAfterLoad = getChromiumTreeMemory(rootPid);
  console.log(`   (Chromium tree working set after setContent: ${chromeAfterLoad.rssMb} MB [took ${(tSetContent / 1000).toFixed(2)}s])`);

  const tPdf0 = performance.now();
  const pdfArray = await page.pdf({
    width: `${sheetW}mm`,
    height: `${sheetH}mm`,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    printBackground: true,
    preferCSSPageSize: true,
  });
  const tPdf = performance.now() - tPdf0;
  const pdfBuffer = Buffer.from(pdfArray);

  const chromeAfterPdf = getChromiumTreeMemory(rootPid);
  const mAfterChromium = process.memoryUsage();
  printMem("5. After Chromium", mAfterChromium, mBeforeChromium);
  console.log(`   (Chromium tree working set peak after PDF: ${chromeAfterPdf.rssMb} MB across ${chromeAfterPdf.processCount} processes [PDF generation took ${(tPdf / 1000).toFixed(2)}s])`);
  console.log(`   (Generated PDF buffer size: ${fmtMb(pdfBuffer.length)} MB, pages: ${layoutResult.pages.length})`);

  // Close Chromium
  await page.close().catch(() => {});
  await browser.close().catch(() => {});

  // STAGE 6: After Export (Cleanup & GC)
  // Release in-memory references
  cardRenders.length = 0;
  cardMap.clear();
  pageSvgs.length = 0;

  const mAfterExport = process.memoryUsage();
  printMem("6. After export", mAfterExport, mAfterChromium);

  if (typeof global.gc === "function") {
    global.gc();
    const mAfterGc = process.memoryUsage();
    printMem("6b. After manual GC", mAfterGc, mAfterExport);
  }

  // Cleanup temp files
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log(`[cleanup] Removed ${tempDir}`);
  } catch {
    // ignore
  }

  console.log("================================================================================");
  console.log("SUMMARY OF PROBE MEASUREMENTS (MB):");
  console.log("Stage                    | Node RSS | Node Heap | Node Ext  | Node ArrayBuf | Chromium Tree RSS");
  console.log(`0. Idle                  | ${fmtMb(mIdle.rss).padStart(8)} | ${fmtMb(mIdle.heapUsed).padStart(9)} | ${fmtMb(mIdle.external).padStart(9)} | ${fmtMb(mIdle.arrayBuffers).padStart(13)} |         0.00`);
  console.log(`1. After load            | ${fmtMb(mAfterLoad.rss).padStart(8)} | ${fmtMb(mAfterLoad.heapUsed).padStart(9)} | ${fmtMb(mAfterLoad.external).padStart(9)} | ${fmtMb(mAfterLoad.arrayBuffers).padStart(13)} |         0.00`);
  console.log(`2. After SVG build       | ${fmtMb(mAfterSvg.rss).padStart(8)} | ${fmtMb(mAfterSvg.heapUsed).padStart(9)} | ${fmtMb(mAfterSvg.external).padStart(9)} | ${fmtMb(mAfterSvg.arrayBuffers).padStart(13)} |         0.00`);
  console.log(`3. After HTML build      | ${fmtMb(mAfterHtml.rss).padStart(8)} | ${fmtMb(mAfterHtml.heapUsed).padStart(9)} | ${fmtMb(mAfterHtml.external).padStart(9)} | ${fmtMb(mAfterHtml.arrayBuffers).padStart(13)} |         0.00`);
  console.log(`4. Before Chromium       | ${fmtMb(mBeforeChromium.rss).padStart(8)} | ${fmtMb(mBeforeChromium.heapUsed).padStart(9)} | ${fmtMb(mBeforeChromium.external).padStart(9)} | ${fmtMb(mBeforeChromium.arrayBuffers).padStart(13)} | ${chromeBefore.rssMb.padStart(12)}`);
  console.log(`5. After Chromium        | ${fmtMb(mAfterChromium.rss).padStart(8)} | ${fmtMb(mAfterChromium.heapUsed).padStart(9)} | ${fmtMb(mAfterChromium.external).padStart(9)} | ${fmtMb(mAfterChromium.arrayBuffers).padStart(13)} | ${chromeAfterPdf.rssMb.padStart(12)}`);
  console.log(`6. After export (closed) | ${fmtMb(mAfterExport.rss).padStart(8)} | ${fmtMb(mAfterExport.heapUsed).padStart(9)} | ${fmtMb(mAfterExport.external).padStart(9)} | ${fmtMb(mAfterExport.arrayBuffers).padStart(13)} |         0.00`);
  if (typeof global.gc === "function") {
    // @ts-ignore
    const mAfterGc = process.memoryUsage();
    console.log(`6b. After manual GC      | ${fmtMb(mAfterGc.rss).padStart(8)} | ${fmtMb(mAfterGc.heapUsed).padStart(9)} | ${fmtMb(mAfterGc.external).padStart(9)} | ${fmtMb(mAfterGc.arrayBuffers).padStart(13)} |         0.00`);
  }
  console.log("================================================================================");

  // MONOLITHIC TEST: Now call exportSheet() directly
  console.log("\n================================================================================");
  console.log("DIRECT MONOLITHIC exportSheet() CALL TEST");
  console.log("================================================================================");
  const tempDir2 = path.join(os.tmpdir(), `acm-studio-mem-probe2-${Date.now()}`);
  await fs.mkdir(tempDir2, { recursive: true });

  const noise = Buffer.alloc(800 * 1100 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 41) & 0xff;
  const sampleMaster = await sharp(noise, { raw: { width: 800, height: 1100, channels: 3 } })
    .resize(1600, 2200)
    .jpeg({ quality: 85 })
    .toBuffer();

  const directPeople = [];
  for (let i = 1; i <= 215; i++) {
    const pid = `HX26-P-${String(i).padStart(3, "0")}`;
    const filePath = path.join(tempDir2, `${pid}.jpg`);
    await fs.writeFile(filePath, sampleMaster);
    directPeople.push({
      id: pid,
      name: `Direct Attendee ${i}`,
      roleId: roles[(i - 1) % roles.length],
      org: "SVNIT",
      photo: filePath,
    });
  }

  const directPhotoSource = async (pid) => {
    const p = directPeople.find((x) => x.id === pid);
    return p ? fs.readFile(p.photo) : null;
  };

  const directBrowser = await launchBrowser();
  const directPid = directBrowser.process()?.pid;

  const mBeforeDirect = process.memoryUsage();
  printMem("Direct export before", mBeforeDirect);

  // High-precision sampler for peak Node memory (non-blocking)
  let peakNodeRss = mBeforeDirect.rss;
  let peakNodeHeap = mBeforeDirect.heapUsed;

  const sampleInterval = setInterval(() => {
    const mem = process.memoryUsage();
    if (mem.rss > peakNodeRss) peakNodeRss = mem.rss;
    if (mem.heapUsed > peakNodeHeap) peakNodeHeap = mem.heapUsed;
  }, 25);

  const tDirect0 = performance.now();
  const directResult = await exportSheet(
    {
      eventSpec: sampleEventSpec,
      draft: selectedDraft,
      people: directPeople,
      photoSource: directPhotoSource,
      brand: assets.brandKit,
      fonts: assets.fonts,
    },
    {
      format: "pdf",
      mode: "sheets",
      sheet: { paper: "A4" },
      dpi: 300,
    },
    { acknowledgedWarnings: true, browser: directBrowser }
  );
  const tDirect = performance.now() - tDirect0;

  clearInterval(sampleInterval);
  const chromeAfterDirect = getChromiumTreeMemory(directPid);

  const mAfterDirect = process.memoryUsage();
  printMem("Direct export after", mAfterDirect, mBeforeDirect);
  console.log(`Direct export success: ${directResult.ok}, PDF bytes: ${fmtMb(directResult.data?.length || 0)} MB, pages: ${directResult.pageCount}, duration: ${(tDirect / 1000).toFixed(2)}s`);
  console.log(`[Peak Sampled during exportSheet] Node RSS Peak: ${fmtMb(peakNodeRss)} MB, Node Heap Peak: ${fmtMb(peakNodeHeap)} MB, Chromium Working Set: ${chromeAfterDirect.rssMb} MB`);
  console.log(`[Combined Memory during exportSheet] ${(peakNodeRss / 1024 / 1024 + chromeAfterDirect.rssBytes / 1024 / 1024).toFixed(2)} MB`);

  // Run a second export to test repeated export behavior
  console.log("\n--- Testing Repeated Export on same browser ---");
  const mBeforeRepeat = process.memoryUsage();
  const tRepeat0 = performance.now();
  const repeatResult = await exportSheet(
    {
      eventSpec: sampleEventSpec,
      draft: selectedDraft,
      people: directPeople,
      photoSource: directPhotoSource,
      brand: assets.brandKit,
      fonts: assets.fonts,
    },
    {
      format: "pdf",
      mode: "sheets",
      sheet: { paper: "A4" },
      dpi: 300,
    },
    { acknowledgedWarnings: true, browser: directBrowser }
  );
  const tRepeat = performance.now() - tRepeat0;
  const mAfterRepeat = process.memoryUsage();
  printMem("Repeat export after", mAfterRepeat, mBeforeRepeat);
  console.log(`Repeat export success: ${repeatResult.ok}, PDF bytes: ${fmtMb(repeatResult.data?.length || 0)} MB, duration: ${(tRepeat / 1000).toFixed(2)}s`);

  await directBrowser.close().catch(() => {});
  await fs.rm(tempDir2, { recursive: true, force: true });
}

main().catch((err) => {
  console.error("Fatal probe error:", err);
  process.exit(1);
});
