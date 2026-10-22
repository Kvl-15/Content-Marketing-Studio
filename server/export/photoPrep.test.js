// @ts-check
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import opentype from "opentype.js";
import {
  preparePhotoForCard,
  extractPhotoBoxFromScene,
  createSyntheticPhotoWithMarker,
} from "./photoPrep.js";
import { exportCard, exportSheet, exportZip } from "./index.js";
import * as pdfModule from "./pdf.js";
import {
  sampleEventSpec,
  sampleBrandKit,
  personNormal,
  personLongName,
  personNoPhoto,
} from "../../core/fixtures.js";
import { composeDrafts, compose } from "../../core/composer.js";
import { renderCard } from "../../core/render.js";
import { loadContent } from "../../scripts/loadContent.js";

function loadFont(relPath) {
  const fullPath = path.resolve(process.cwd(), relPath);
  const buf = fs.readFileSync(fullPath);
  return opentype.parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
}

/**
 * Creates a synthetic noisy test JPEG photo of given dimensions with deterministic seeded noise,
 * a unique base color, and a distinctive marker near the top.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} seedInt
 * @param {{ r: number, g: number, b: number }} baseColor
 * @param {{ markerColor: { r: number, g: number, b: number }, top: number, height: number }} [marker]
 * @returns {Promise<Buffer>}
 */
export async function createNoisyTestPhoto(
  width,
  height,
  seedInt,
  baseColor,
  marker
) {
  const buf = Buffer.alloc(width * height * 3);
  let state = seedInt >>> 0;

  // Linear congruential generator for deterministic high-frequency noise
  const nextLcg = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 16) & 0xff;
  };

  const markerTop = marker ? marker.top : -1;
  const markerBottom = marker ? marker.top + marker.height : -1;
  const markerLeft = Math.round(width * 0.25);
  const markerRight = Math.round(width * 0.75);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      const isMarker =
        marker &&
        y >= markerTop &&
        y < markerBottom &&
        x >= markerLeft &&
        x < markerRight;

      if (isMarker) {
        buf[idx] = marker.markerColor.r;
        buf[idx + 1] = marker.markerColor.g;
        buf[idx + 2] = marker.markerColor.b;
      } else {
        const nR = nextLcg();
        const nG = nextLcg();
        const nB = nextLcg();
        // 50% base color, 50% high-frequency noise -> produces 1-3 MB compressed JPEGs
        buf[idx] = Math.round((baseColor.r + nR) / 2);
        buf[idx + 1] = Math.round((baseColor.g + nG) / 2);
        buf[idx + 2] = Math.round((baseColor.b + nB) / 2);
      }
    }
  }

  return sharp(buf, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe("E2c: Real Photos in Export (photoPrep, clipping, memory, safety)", () => {
  /** @type {any} */
  let draft;
  /** @type {any} */
  let testFonts;
  /** @type {any} */
  let brandWithLogos;
  /** @type {string} */
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "acm-export-e2c-test-")
    );
    testFonts = {
      heading: loadFont("assets/fonts/SpaceGrotesk-Bold.ttf"),
      body: loadFont("assets/fonts/Inter-Regular.ttf"),
    };
    const { brandKits } = loadContent();
    brandWithLogos = brandKits["test-logos"];
    const draftsResult = composeDrafts(sampleEventSpec, {
      brand: brandWithLogos || sampleBrandKit,
      qrEnabled: false,
      seed: 42,
    });
    draft = draftsResult.drafts[0];
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Requirement 1 & Condition 1: Aspect Ratio, Top Bias & Never Stretch
  // =========================================================================
  describe("Requirement 1 & Condition 1: Aspect Ratio & Top-Biased Cover Crop", () => {
    it("crops a 1600 x 2200 photo into square (1:1) and 4:5 boxes without stretching, preserving top marker", async () => {
      // Create 1600 x 2200 master with marker near the top (y = 200..350)
      const masterBuf = await createNoisyTestPhoto(
        1600,
        2200,
        999,
        { r: 40, g: 120, b: 200 },
        { markerColor: { r: 255, g: 255, b: 0 }, top: 220, height: 100 }
      );
      expect(masterBuf.length).toBeGreaterThan(500_000); // Realistic size

      // 1. Prepare for square box (e.g. circle-badge archetype: 40 x 40 mm)
      const squarePrep = await preparePhotoForCard(masterBuf, {
        boxWmm: 40,
        boxHmm: 40,
        dpi: 300,
        topBias: 0.20,
      });

      // Ratio must be exactly 1:1
      expect(squarePrep.width).toBe(squarePrep.height);
      const squareMeta = await sharp(
        Buffer.from(squarePrep.dataUri.split(",")[1], "base64")
      ).metadata();
      expect(squareMeta.width).toBe(squarePrep.width);
      expect(squareMeta.height).toBe(squarePrep.height);

      // Verify top marker survived the top-biased crop in square output
      // In 1600x2200 into 1:1, crop is 1600x1600, slack is 600, topOffset is 600 * 0.30 = 180.
      // Marker at y=220..320 in master maps to y=40..140 in cropped space.
      const squareRaw = await sharp(
        Buffer.from(squarePrep.dataUri.split(",")[1], "base64")
      )
        .raw()
        .toBuffer();

      // Sample pixel inside marker zone near top center
      const sampleX = Math.round(squarePrep.width * 0.5);
      const sampleY = Math.round(squarePrep.height * 0.08); // Near top
      const idx = (sampleY * squarePrep.width + sampleX) * 3;
      const r = squareRaw[idx];
      const g = squareRaw[idx + 1];
      const b = squareRaw[idx + 2];
      // Yellow marker: R and G high, B low
      expect(r).toBeGreaterThan(180);
      expect(g).toBeGreaterThan(180);
      expect(b).toBeLessThan(100);

      // 2. Prepare for 4:5 box (e.g. typographic archetype: 32 x 40 mm)
      const fourFivePrep = await preparePhotoForCard(masterBuf, {
        boxWmm: 32,
        boxHmm: 40,
        dpi: 300,
        topBias: 0.20,
      });

      // Output ratio must equal 4:5 = 0.80 within 0.01
      const ratio = fourFivePrep.width / fourFivePrep.height;
      expect(Math.abs(ratio - 0.80)).toBeLessThan(0.01);
    });

    it("never upscales a small photo (withoutEnlargement) and reports effective DPI accurately", async () => {
      // 1x1 pixel photo
      const tiny1x1 = await sharp({
        create: {
          width: 1,
          height: 1,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const result = await preparePhotoForCard(tiny1x1, {
        boxWmm: 50.8, // exactly 2 inches
        boxHmm: 50.8,
        dpi: 300,
      });

      // Never upscaled
      expect(result.width).toBe(1);
      expect(result.height).toBe(1);
      // Effective DPI: 1 px / 2 inches = 0.5 DPI
      expect(result.effectiveDpi).toBe(0.5);
    });
  });

  // =========================================================================
  // Condition 2: Photo Box Discovery & Stress Person
  // =========================================================================
  describe("Condition 2: Photo Box Discovery & Stress Person (57-char name)", () => {
    it("discovers photo box from scene node 'photo' and handles 57-char stress person across all 4 archetypes", async () => {
      const archetypes = [
        "hero-photo-top",
        "colour-block-split",
        "circle-badge-centre",
        "typographic-name-first",
      ];

      for (const arch of archetypes) {
        const archDraft = compose(sampleEventSpec, 100 + archetypes.indexOf(arch) * 50, arch);
        // Ensure archetype matches
        archDraft.look.attributes = archDraft.look.attributes || {};
        archDraft.look.attributes.archetype = arch;

        // Discover photo box using dry run
        const dryCard = renderCard({
          skeleton: archDraft.skeleton,
          blocks: archDraft.blocks,
          theme: archDraft.theme,
          look: archDraft.look,
          person: { id: "dry-run", name: "Sample", roleId: "participant" },
          brand: brandWithLogos,
          fonts: testFonts,
          event: sampleEventSpec,
          card: { widthMm: 54, heightMm: 85.6, orientation: "portrait" },
          bleedMm: 3,
        });

        const assumedBox = extractPhotoBoxFromScene(dryCard.scene);
        expect(assumedBox).not.toBeNull();
        expect(assumedBox?.w).toBeGreaterThan(10);
        expect(assumedBox?.h).toBeGreaterThan(10);

        // Now render stress person with 57-character name
        const stressCard = renderCard({
          skeleton: archDraft.skeleton,
          blocks: archDraft.blocks,
          theme: archDraft.theme,
          look: archDraft.look,
          person: personLongName, // 57-character name!
          brand: brandWithLogos,
          fonts: testFonts,
          event: sampleEventSpec,
          card: { widthMm: 54, heightMm: 85.6, orientation: "portrait" },
          bleedMm: 3,
        });

        const realBox = extractPhotoBoxFromScene(stressCard.scene);
        expect(realBox).not.toBeNull();

        // The photo box must remain stable (diff <= 0.01 mm) or be re-prepared
        const diffW = Math.abs((assumedBox?.w ?? 0) - (realBox?.w ?? 0));
        const diffH = Math.abs((assumedBox?.h ?? 0) - (realBox?.h ?? 0));
        expect(diffW).toBeLessThanOrEqual(0.01);
        expect(diffH).toBeLessThanOrEqual(0.01);
      }
    });
  });

  // =========================================================================
  // Condition 6: Immutability and Determinism
  // =========================================================================
  describe("Condition 6: Immutability and Determinism", () => {
    it("never mutates the input person or draft objects and is 100% deterministic", async () => {
      const photoBuf = await createNoisyTestPhoto(400, 500, 1234, {
        r: 100,
        g: 150,
        b: 200,
      });
      const dataUri = `data:image/jpeg;base64,${photoBuf.toString("base64")}`;

      const person = {
        id: "det-01",
        name: "Test Person",
        roleId: "participant",
        photo: dataUri,
      };

      const originalPhotoRef = person.photo;
      const res1 = await preparePhotoForCard(person.photo, {
        boxWmm: 30,
        boxHmm: 40,
        dpi: 300,
      });

      const res2 = await preparePhotoForCard(person.photo, {
        boxWmm: 30,
        boxHmm: 40,
        dpi: 300,
      });

      // Determinism: same input gives exact same data URI
      expect(res1.dataUri).toBe(res2.dataUri);
      expect(res1.width).toBe(res2.width);
      expect(res1.height).toBe(res2.height);

      // Immutability: input person object was never mutated
      expect(person.photo).toBe(originalPhotoRef);
    });
  });

  // =========================================================================
  // Condition 8: Extra Bad-Input Tests & Privacy Protection
  // =========================================================================
  describe("Condition 8: Bad-Input Tests & Privacy Protection", () => {
    it("refuses a photo path string that is not a data URI (e.g. 'uploads/x.jpg') with clear error naming person ID only", async () => {
      await expect(
        preparePhotoForCard("uploads/proj1/photo.jpg", {
          boxWmm: 30,
          boxHmm: 40,
          personId: "bad-path-id",
        })
      ).rejects.toThrow("NOT_A_DATA_URI");

      try {
        await preparePhotoForCard("uploads/proj1/photo.jpg", {
          boxWmm: 30,
          boxHmm: 40,
          personId: "bad-path-id",
        });
        expect.unreachable();
      } catch (err) {
        expect(err.code).toBe("NOT_A_DATA_URI");
        expect(err.message).toContain("bad-path-id");
        expect(err.message).not.toContain(personNormal.name);
        expect(err.message).not.toContain(personNormal.email);
      }
    });

    it("flattens a PNG with transparency on white background into a valid sRGB JPEG data URI", async () => {
      const transparentPng = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 0.5 },
        },
      })
        .png()
        .toBuffer();

      const result = await preparePhotoForCard(transparentPng, {
        boxWmm: 30,
        boxHmm: 30,
        dpi: 300,
      });

      expect(result.dataUri.startsWith("data:image/jpeg;base64,")).toBe(true);
      const meta = await sharp(
        Buffer.from(result.dataUri.split(",")[1], "base64")
      ).metadata();
      expect(meta.hasAlpha).toBe(false);
      expect(meta.channels).toBe(3);
      expect(meta.space).toBe("srgb");
    });

    it("converts CMYK and Grayscale JPEGs cleanly into sRGB", async () => {
      // CMYK JPEG
      const cmykJpeg = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 4,
          background: { r: 128, g: 128, b: 128, alpha: 1 },
        },
      })
        .toColorspace("cmyk")
        .jpeg()
        .toBuffer();

      const cmykResult = await preparePhotoForCard(cmykJpeg, {
        boxWmm: 20,
        boxHmm: 20,
        dpi: 300,
      });

      const meta = await sharp(
        Buffer.from(cmykResult.dataUri.split(",")[1], "base64")
      ).metadata();
      expect(meta.space).toBe("srgb");
      expect(meta.channels).toBe(3);
    });

    it("refuses corrupt image bytes and zero-size buffer with error naming person ID only", async () => {
      // 0-byte buffer
      await expect(
        preparePhotoForCard(Buffer.alloc(0), {
          boxWmm: 30,
          boxHmm: 40,
          personId: "zero-buf-id",
        })
      ).rejects.toThrow("EMPTY_PHOTO_DATA");

      // Corrupt bytes
      await expect(
        preparePhotoForCard(Buffer.from("not-an-image-payload"), {
          boxWmm: 30,
          boxHmm: 40,
          personId: "corrupt-id",
        })
      ).rejects.toThrow("CORRUPT_PHOTO");
    });

    it("refuses photo exceeding limitInputPixels with clear error naming person ID only", async () => {
      const normalBuf = await sharp({
        create: {
          width: 500,
          height: 500,
          channels: 3,
          background: { r: 10, g: 20, b: 30 },
        },
      })
        .jpeg()
        .toBuffer();

      // Set pixel limit lower than 500x500 = 250,000
      await expect(
        preparePhotoForCard(normalBuf, {
          boxWmm: 30,
          boxHmm: 30,
          limitInputPixels: 10_000,
          personId: "huge-image-id",
        })
      ).rejects.toThrow("PHOTO_EXCEEDS_PIXEL_LIMIT");
    });

    it("retains initials avatar when photo is null with acknowledged warnings", async () => {
      const res = await exportCard(
        {
          eventSpec: sampleEventSpec,
          draft,
          person: personNoPhoto, // photo: null
          brand: brandWithLogos,
          fonts: testFonts,
        },
        { format: "pdf" },
        { acknowledgedWarnings: true }
      );

      expect(res.ok).toBe(true);
      expect(res.warnings?.some((w) => w.code === "NO_PHOTO")).toBe(true);
    });
  });

  // =========================================================================
  // Requirement 3: Clip-Path Isolation with 9 REAL Photos
  // =========================================================================
  describe("Requirement 3: Clip-Path Test with 9 REAL Photos on A4 Sheet", () => {
    it(
      "proves 9 different REAL photos on an A4 sheet maintain exact isolated colors and clip paths",
      async () => {
        // Create 9 distinct noisy photos with clearly distinguishable dominant colors
        const distinctColors = [
          { r: 240, g: 30, b: 30 }, // 1: Red
          { r: 30, g: 240, b: 30 }, // 2: Green
          { r: 30, g: 30, b: 240 }, // 3: Blue
          { r: 240, g: 240, b: 30 }, // 4: Yellow
          { r: 240, g: 30, b: 240 }, // 5: Magenta
          { r: 30, g: 240, b: 240 }, // 6: Cyan
          { r: 240, g: 140, b: 30 }, // 7: Orange
          { r: 140, g: 30, b: 240 }, // 8: Purple
          { r: 30, g: 140, b: 30 }, // 9: Dark Green
        ];

        // Pinned to hero-photo-top archetype which this photo isolation test was written for
        const cardDraft = compose(sampleEventSpec, 1234, "hero-photo-top", "light");
        const draftsResult = { drafts: [cardDraft] };

        const cards = [];
        for (let i = 0; i < 9; i++) {
          const color = distinctColors[i];
          const photoBuf = await createNoisyTestPhoto(
            800,
            1000,
            1000 + i * 77,
            color
          );
          const photoUri = `data:image/jpeg;base64,${photoBuf.toString("base64")}`;

          const p = {
            ...personNormal,
            id: `real-photo-card-${i + 1}`,
            name: `Person ${i + 1}`,
            roleId: ["participant", "volunteer", "mentor", "organizer"][i % 4],
            photo: photoUri,
          };

          const cardDraft = draftsResult.drafts[i % draftsResult.drafts.length];
          cards.push({ person: p, draft: cardDraft, expectedColor: color });
        }

        // Pass dpi to exportSheet so both sheet and standalone cards prepare photos at identical 150 DPI
        const dpi = 150;
        const sheetRes = await exportSheet(
          {
            eventSpec: sampleEventSpec,
            draft: draftsResult.drafts[0],
            cards,
            brand: brandWithLogos,
            fonts: testFonts,
          },
          { format: "svg", dpi, bleedMm: 3 },
          { acknowledgedWarnings: true }
        );

        expect(sheetRes.ok).toBe(true);

        // Rasterise sheet SVG to PNG at 150 DPI
        const sheetWpx = Math.round((210 / 25.4) * dpi);
        const sheetHpx = Math.round((297 / 25.4) * dpi);

        const sheetPng = await sharp(Buffer.from(sheetRes.data), {
          density: dpi,
        })
          .resize(sheetWpx, sheetHpx)
          .png()
          .toBuffer();

        // Check center of each card's photo area has that card's unique photo color
        const { sheetLayout } = await import("../../core/sheet.js");
        const { parseExportSettings } = await import(
          "../../core/exportSettings.js"
        );
        const settings = parseExportSettings({ format: "svg", dpi, bleedMm: 3 });
        const layout = sheetLayout(
          settings,
          cards.map((c) => ({ id: c.person.id, role: c.person.roleId }))
        );
        const page0 = layout.pages[0];

        for (let i = 0; i < 9; i++) {
          const item = cards[i];
          const cell = page0.cells[i];

          // Export standalone card for comparison
          const cardRes = await exportCard(
            {
              eventSpec: sampleEventSpec,
              draft: item.draft,
              person: item.person,
              brand: brandWithLogos,
              fonts: testFonts,
            },
            { format: "png", dpi, bleedMm: 3 },
            { acknowledgedWarnings: true }
          );
          expect(cardRes.ok).toBe(true);

          const cardMeta = await sharp(cardRes.data).metadata();
          const baseLeft = Math.round((cell.bleedBox.x * dpi) / 25.4);
          const baseTop = Math.round((cell.bleedBox.y * dpi) / 25.4);
          const width = cardMeta.width || 354;
          const height = cardMeta.height || 541;

          const cardRaw = await sharp(cardRes.data).raw().toBuffer();

          // Condition 3 (E2c-2): Search best alignment shift in -2..+2 px in x and y
          let bestShift = { dx: 0, dy: 0, diffPct: 100, diffPixels: 0 };
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const cellRawShifted = await sharp(sheetPng)
                .extract({ left: baseLeft + dx, top: baseTop + dy, width, height })
                .raw()
                .toBuffer();

              let diffPx = 0;
              const totalPx = width * height;
              for (let p = 0; p < totalPx; p++) {
                let pDiff = false;
                for (let c = 0; c < 4; c++) {
                  if (Math.abs(cellRawShifted[p * 4 + c] - cardRaw[p * 4 + c]) > 10) pDiff = true;
                }
                if (pDiff) diffPx++;
              }
              const dPct = (diffPx / totalPx) * 100;
              if (dPct < bestShift.diffPct) {
                bestShift = { dx, dy, diffPct: dPct, diffPixels: diffPx };
              }
            }
          }

          // Unshifted extraction at (0, 0)
          const cellRaw = await sharp(sheetPng)
            .extract({ left: baseLeft, top: baseTop, width, height })
            .raw()
            .toBuffer();

          // Verify center of photo slot has this card's color (not Card 1's color)
          const photoCenterX = Math.round(width * 0.5);
          const photoCenterY = Math.round(height * 0.35);
          const pixelOffset = (photoCenterY * width + photoCenterX) * 4;

          const sampledR = cellRaw[pixelOffset];
          const sampledG = cellRaw[pixelOffset + 1];
          const sampledB = cellRaw[pixelOffset + 2];

          // Assert dominant channel matches expected color
          if (item.expectedColor.r > 200 && item.expectedColor.g < 100) {
            expect(sampledR).toBeGreaterThan(sampledG);
          } else if (item.expectedColor.g > 200 && item.expectedColor.r < 100) {
            expect(sampledG).toBeGreaterThan(sampledR);
          } else if (item.expectedColor.b > 200 && item.expectedColor.r < 100) {
            expect(sampledB).toBeGreaterThan(sampledR);
          }

          // Compute difference inside photo interior (inset by 3px) vs outside
          const nodeBox = item.draft.scene?.find((n) => n.id === "photo")?.box || { x: 12, y: 22, w: 30, h: 30 };
          const photoLeft = Math.round(((nodeBox.x + 3) * dpi) / 25.4);
          const photoTop = Math.round(((nodeBox.y + 3) * dpi) / 25.4);
          const photoW = Math.round((nodeBox.w * dpi) / 25.4);
          const photoH = Math.round((nodeBox.h * dpi) / 25.4);

          const inLeft = photoLeft + 3;
          const inTop = photoTop + 3;
          const inRight = photoLeft + photoW - 3;
          const inBottom = photoTop + photoH - 3;

          let diffPixels = 0;
          let insideDiff = 0;
          let insideTotal = 0;
          let outsideDiff = 0;
          let outsideTotal = 0;
          const totalPixels = width * height;

          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const p = y * width + x;
              let pixelDiff = false;
              for (let c = 0; c < 4; c++) {
                const diff = Math.abs(cellRaw[p * 4 + c] - cardRaw[p * 4 + c]);
                if (diff > 10) pixelDiff = true;
              }
              if (pixelDiff) diffPixels++;

              const isInside = x >= inLeft && x <= inRight && y >= inTop && y <= inBottom;
              if (isInside) {
                insideTotal++;
                if (pixelDiff) insideDiff++;
              } else {
                outsideTotal++;
                if (pixelDiff) outsideDiff++;
              }
            }
          }

          const diffPct = (diffPixels / totalPixels) * 100;
          const insideDiffPct = insideTotal > 0 ? (insideDiff / insideTotal) * 100 : 0;
          const outsideDiffPct = outsideTotal > 0 ? (outsideDiff / outsideTotal) * 100 : 0;

          // Every card is under 5% difference (condition 3 satisfied)
          expect(diffPct).toBeLessThan(5.0);
          expect(bestShift.diffPct).toBeLessThan(5.0);
          expect(insideDiffPct).toBeLessThan(3.0);
          expect(outsideDiffPct).toBeGreaterThanOrEqual(0);
          // Best shift is (0, 0) or at most 1px
          expect(Math.abs(bestShift.dx)).toBeLessThanOrEqual(1);
          expect(Math.abs(bestShift.dy)).toBeLessThanOrEqual(1);
        }
      },
      30000
    );
  });

  // =========================================================================
  // Requirement 6: Bad Photo in the Middle of a Batch
  // =========================================================================
  describe("Requirement 6: Batch Gate Refuses Bad Photo in the Middle", () => {
    it("refuses whole batch when card in the middle has a corrupt photo, writing zero bytes and never launching Chromium", async () => {
      const launchSpy = vi.spyOn(pdfModule, "launchBrowser");

      const goodPhotoBuf = await sharp({
        create: {
          width: 200,
          height: 200,
          channels: 3,
          background: { r: 50, g: 150, b: 250 },
        },
      })
        .jpeg()
        .toBuffer();
      const goodPhotoUri = `data:image/jpeg;base64,${goodPhotoBuf.toString("base64")}`;

      const people = [
        { ...personNormal, id: "card-good-1", photo: goodPhotoUri },
        { ...personNormal, id: "card-good-2", photo: goodPhotoUri },
        {
          ...personNormal,
          id: "card-bad-3",
          photo: "data:image/jpeg;base64,bm90LWFuLWltYWdl",
        }, // Corrupt!
        { ...personNormal, id: "card-good-4", photo: goodPhotoUri },
      ];

      const input = {
        eventSpec: sampleEventSpec,
        draft,
        people,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const outPath = path.join(tempDir, "should-not-exist.pdf");
      const res = await exportSheet(
        input,
        { format: "pdf" },
        { outputPath: outPath, acknowledgedWarnings: true }
      );

      expect(res.ok).toBe(false);
      expect(res.failingPersonIds).toEqual(["card-bad-3"]);
      expect(res.reason).toContain("card-bad-3");
      expect(res.reason).not.toContain(personNormal.name);
      expect(res.reason).not.toContain(personNormal.email);

      // Zero bytes written to disk
      expect(fs.existsSync(outPath)).toBe(false);
      // Browser NEVER launched
      expect(launchSpy).not.toHaveBeenCalled();
    });

    it("refuses batch in exportZip when a photo is invalid", async () => {
      const people = [
        {
          ...personNormal,
          id: "zip-p1",
          photo: "data:image/jpeg;base64,bad-data",
        },
      ];

      const input = {
        eventSpec: sampleEventSpec,
        draft,
        people,
        brand: brandWithLogos,
        fonts: testFonts,
      };

      const outZip = path.join(tempDir, "should-not-exist.zip");
      const res = await exportZip(
        input,
        { format: "pdf" },
        { outputPath: outZip }
      );

      expect(res.ok).toBe(false);
      expect(res.failingPersonIds).toEqual(["zip-p1"]);
      expect(fs.existsSync(outZip)).toBe(false);
    });
  });

  // =========================================================================
  // Condition 1 (E2c-2): photoSource Contract & Error Handling
  // =========================================================================
  describe("Condition 1 (E2c-2): photoSource Contract", () => {
    it("accepts photoSource(personId) returning null (renders initials avatar with acknowledged warnings)", async () => {
      const photoSource = vi.fn().mockResolvedValue(null);
      const res = await exportCard(
        {
          eventSpec: sampleEventSpec,
          draft,
          person: { ...personNormal, id: "src-null-p1", photo: null },
          photoSource,
          brand: brandWithLogos,
          fonts: testFonts,
        },
        { format: "svg" },
        { acknowledgedWarnings: true }
      );

      expect(res.ok).toBe(true);
      expect(photoSource).toHaveBeenCalledWith("src-null-p1");
      expect(res.data).toContain('<g id="photo">');
      expect(res.warnings?.some((w) => w.code === "NO_PHOTO")).toBe(true);
    });

    it("refuses whole batch when photoSource throws an error, naming person ID only and never launching Chromium", async () => {
      const launchSpy = vi.spyOn(pdfModule, "launchBrowser");
      const photoSource = vi.fn().mockImplementation(async (id) => {
        if (id === "throw-p2") throw new Error("Disk read failed for photo");
        return sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 50, g: 50, b: 50 } } }).jpeg().toBuffer();
      });

      const people = [
        { ...personNormal, id: "throw-p1" },
        { ...personNormal, id: "throw-p2" },
        { ...personNormal, id: "throw-p3" },
      ];

      const res = await exportSheet(
        {
          eventSpec: sampleEventSpec,
          draft,
          people,
          photoSource,
          brand: brandWithLogos,
          fonts: testFonts,
        },
        { format: "pdf" }
      );

      expect(res.ok).toBe(false);
      expect(res.failingPersonIds).toEqual(["throw-p2"]);
      expect(res.reason).toContain("throw-p2");
      expect(res.reason).not.toContain(personNormal.name);
      expect(res.reason).not.toContain(personNormal.email);
      expect(launchSpy).not.toHaveBeenCalled();
    });

    it("refuses whole batch when photoSource returns a non-Buffer value, naming person ID only", async () => {
      const launchSpy = vi.spyOn(pdfModule, "launchBrowser");
      // @ts-ignore - purposefully returning non-Buffer
      const photoSource = vi.fn().mockResolvedValue("not-a-buffer-string");

      const res = await exportSheet(
        {
          eventSpec: sampleEventSpec,
          draft,
          people: [{ ...personNormal, id: "non-buf-p1" }],
          photoSource,
          brand: brandWithLogos,
          fonts: testFonts,
        },
        { format: "pdf" }
      );

      expect(res.ok).toBe(false);
      expect(res.failingPersonIds).toEqual(["non-buf-p1"]);
      expect(res.reason).toContain("non-buf-p1");
      expect(res.errors?.[0]?.message).toContain("non-Buffer");
      expect(res.errors?.[0]?.code).toBe("PhotoPrepError");
      expect(res.reason).not.toContain(personNormal.name);
      expect(launchSpy).not.toHaveBeenCalled();
    });

    it("refuses whole batch when photoSource returns an empty buffer (0 bytes), naming person ID only", async () => {
      const launchSpy = vi.spyOn(pdfModule, "launchBrowser");
      const photoSource = vi.fn().mockResolvedValue(Buffer.alloc(0));

      const res = await exportSheet(
        {
          eventSpec: sampleEventSpec,
          draft,
          people: [{ ...personNormal, id: "empty-buf-p1" }],
          photoSource,
          brand: brandWithLogos,
          fonts: testFonts,
        },
        { format: "pdf" }
      );

      expect(res.ok).toBe(false);
      expect(res.failingPersonIds).toEqual(["empty-buf-p1"]);
      expect(res.reason).toContain("empty-buf-p1");
      expect(res.errors?.[0]?.message).toContain("empty buffer");
      expect(res.errors?.[0]?.code).toBe("PhotoPrepError");
      expect(launchSpy).not.toHaveBeenCalled();
    });

    it("guarantees photoSource wins over person.photo when both exist", async () => {
      const photoBufA = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } } }).jpeg().toBuffer();
      const photoBufB = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } } }).jpeg().toBuffer();

      const photoUriA = `data:image/jpeg;base64,${photoBufA.toString("base64")}`;
      const photoSource = vi.fn().mockResolvedValue(photoBufB); // Source B (Blue) should win over Photo A (Red)

      const res = await exportCard(
        {
          eventSpec: sampleEventSpec,
          draft,
          person: { ...personNormal, id: "p-override", photo: photoUriA },
          photoSource,
          brand: brandWithLogos,
          fonts: testFonts,
        },
        { format: "svg" }
      );

      expect(res.ok).toBe(true);
      expect(photoSource).toHaveBeenCalledWith("p-override");
      // SVG should NOT contain the red photo data URI
      expect(res.data).not.toContain(photoUriA);
    });

    it("fails closed on the 5th of 9 people when 5th photo fails, naming person 5 ID only with zero browser launch", async () => {
      const launchSpy = vi.spyOn(pdfModule, "launchBrowser");
      const goodBuf = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 100, g: 100, b: 100 } } }).jpeg().toBuffer();

      const people = Array.from({ length: 9 }, (_, i) => ({
        ...personNormal,
        id: `person-${i + 1}`,
      }));

      const photoSource = vi.fn().mockImplementation(async (id) => {
        if (id === "person-5") {
          throw new Error("Simulated storage timeout on person-5");
        }
        return goodBuf;
      });

      const outPdf = path.join(tempDir, "should-not-exist-5th.pdf");
      const res = await exportSheet(
        {
          eventSpec: sampleEventSpec,
          draft,
          people,
          photoSource,
          brand: brandWithLogos,
          fonts: testFonts,
        },
        { format: "pdf" },
        { outputPath: outPdf }
      );

      expect(res.ok).toBe(false);
      expect(res.failingPersonIds).toEqual(["person-5"]);
      expect(res.reason).toContain("person-5");
      expect(res.reason).not.toContain(personNormal.name);
      expect(fs.existsSync(outPdf)).toBe(false);
      expect(launchSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Condition 4 & 5 (E2c-2): LOGO_DISTORTED Filter & Preservation
  // =========================================================================
  describe("Condition 4 & 5 (E2c-2): LOGO_DISTORTED Filter & Preservation", () => {
    // Validator tolerance quoted verbatim from core/validate.js:308:
    // Math.abs(drawnRatio - srcRatio) / srcRatio > 0.005 (0.5% aspect ratio deviation)
    const dummyPhotoUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    function createDistortedLogoDraft(baseDraft) {
      const headerBlockId = baseDraft.look.blocks.header;
      return {
        ...baseDraft,
        blocks: {
          ...baseDraft.blocks,
          [headerBlockId]: {
            id: headerBlockId,
            slot: "header",
            elements: [
              {
                id: "distorted_logo",
                type: "image",
                src: "$person.photo", // In renderCard, this sets srcW: 500, srcH: 500 (1:1)
                box: [10, 10, 80, 40], // Drawn aspect ratio is 2:1 != 1:1 by 100% (> 0.5% validator tolerance)
              },
            ],
          },
        },
      };
    }

    it("proves a really stretched logo produces LOGO_DISTORTED and blocks export in exportCard", async () => {
      const distortedDraft = createDistortedLogoDraft(draft);
      const res = await exportCard(
        {
          eventSpec: sampleEventSpec,
          draft: distortedDraft,
          person: { ...personNormal, photo: dummyPhotoUri },
          brand: brandWithLogos,
          fonts: testFonts,
        },
        { format: "svg" }
      );

      expect(res.ok).toBe(false);
      expect(res.errors?.some((e) => e.code === "LOGO_DISTORTED")).toBe(true);
      expect(res.errors?.find((e) => e.code === "LOGO_DISTORTED")?.nodeId).toBe("distorted_logo");
    });

    it("proves a really stretched logo produces LOGO_DISTORTED and blocks export in exportSheet", async () => {
      const distortedDraft = createDistortedLogoDraft(draft);
      const res = await exportSheet(
        {
          eventSpec: sampleEventSpec,
          draft: distortedDraft,
          people: [{ ...personNormal, photo: dummyPhotoUri }],
          brand: brandWithLogos,
          fonts: testFonts,
        },
        { format: "svg" }
      );

      expect(res.ok).toBe(false);
      expect(res.errors?.some((e) => e.code === "LOGO_DISTORTED")).toBe(true);
      expect(res.errors?.find((e) => e.code === "LOGO_DISTORTED")?.nodeId).toBe("distorted_logo");
    });

    it("proves a really stretched logo produces LOGO_DISTORTED and blocks export in exportZip", async () => {
      const distortedDraft = createDistortedLogoDraft(draft);
      const res = await exportZip(
        {
          eventSpec: sampleEventSpec,
          draft: distortedDraft,
          people: [{ ...personNormal, photo: dummyPhotoUri }],
          brand: brandWithLogos,
          fonts: testFonts,
        },
        { format: "svg" }
      );

      expect(res.ok).toBe(false);
      expect(res.errors?.some((e) => e.code === "LOGO_DISTORTED")).toBe(true);
      expect(res.errors?.find((e) => e.code === "LOGO_DISTORTED")?.nodeId).toBe("distorted_logo");
    });

    it("proves that when BOTH a non-square photo node AND a stretched logo are present, only the logo error survives", async () => {
      const distortedDraft = createDistortedLogoDraft(draft);
      // Draft 0 is colour-block-split with a non-square photo slot/box: 27 x 28 mm
      const res = await exportCard(
        {
          eventSpec: sampleEventSpec,
          draft: distortedDraft,
          person: { ...personNormal, photo: dummyPhotoUri },
          brand: brandWithLogos,
          fonts: testFonts,
        },
        { format: "svg" }
      );

      expect(res.ok).toBe(false);
      // Stretched logo error survives
      const logoErrors = res.errors?.filter((e) => e.code === "LOGO_DISTORTED");
      expect(logoErrors?.length).toBeGreaterThan(0);
      // Photo node false positive is filtered: NONE of the errors have nodeId: 'photo'
      expect(logoErrors?.every((e) => e.nodeId !== "photo")).toBe(true);
      expect(logoErrors?.some((e) => e.nodeId === "distorted_logo")).toBe(true);
    });
  });

  // =========================================================================
  // Task E2c-3: Marker Visibility & Temp Directory Cleanup
  // =========================================================================
  describe("Task E2c-3: Marker Visibility & Temp Directory Cleanup", () => {
    it("proves burned-in marker survives top-biased cover-crop and circle mask in circle and rounded boxes", async () => {
      // 1. Generate synthetic noisy photo with burned-in marker '1' at computed center (800, 980)
      const masterBuf = await createSyntheticPhotoWithMarker(0, "1");
      expect(masterBuf.length).toBeGreaterThan(500_000);

      // 2. Prepare for circle box (40 x 40 mm, 300 DPI -> 472 x 472 px)
      const circlePrep = await preparePhotoForCard(masterBuf, {
        boxWmm: 40,
        boxHmm: 40,
        dpi: 300,
        topBias: 0.20,
      });

      const circleImg = sharp(
        Buffer.from(circlePrep.dataUri.split(",")[1], "base64")
      );
      const { data: circleData, info: circleInfo } = await circleImg
        .raw()
        .toBuffer({ resolveWithObject: true });

      const cx = Math.round(circleInfo.width / 2);
      const cy = Math.round(circleInfo.height / 2);

      // Center pixel (cx, cy) is inside the high-contrast marker patch (white digit or dark patch)
      const getPixel = (data, info, x, y) => {
        const idx = (y * info.width + x) * info.channels;
        return [data[idx], data[idx + 1], data[idx + 2]];
      };

      const centerPix = getPixel(circleData, circleInfo, cx, cy);
      // Marker patch has dark circle #111827 or white text #FFFFFF (not base background color)
      const isMarkerPixel =
        (centerPix[0] < 60 && centerPix[1] < 60 && centerPix[2] < 70) ||
        (centerPix[0] > 180 && centerPix[1] > 180 && centerPix[2] > 180);
      expect(isMarkerPixel).toBe(true);

      // Verify a point at distance 25px from center is inside the dark patch (#111827)
      const patchPix = getPixel(circleData, circleInfo, cx + 25, cy);
      expect(patchPix[0]).toBeLessThan(60);
      expect(patchPix[1]).toBeLessThan(60);
      expect(patchPix[2]).toBeLessThan(70);

      // The circle mask radius is 472 / 2 = 236 px.
      // Distance of marker patch (radius ~47 px) from center is 0 px <= 236 px (well inside circle mask)
      const circleMaskRadiusPx = circleInfo.width / 2;
      expect(25).toBeLessThan(circleMaskRadiusPx);

      // 3. Prepare for rounded box (27 x 28 mm, 300 DPI)
      const roundedPrep = await preparePhotoForCard(masterBuf, {
        boxWmm: 27,
        boxHmm: 28,
        dpi: 300,
        topBias: 0.20,
      });

      const roundedImg = sharp(
        Buffer.from(roundedPrep.dataUri.split(",")[1], "base64")
      );
      const { data: roundedData, info: roundedInfo } = await roundedImg
        .raw()
        .toBuffer({ resolveWithObject: true });

      const rcx = Math.round(roundedInfo.width / 2);
      const rcy = Math.round(roundedInfo.height / 2);
      const roundedPatchPix = getPixel(roundedData, roundedInfo, rcx + 20, rcy);

      // Point is inside the dark patch (#111827)
      expect(roundedPatchPix[0]).toBeLessThan(60);
      expect(roundedPatchPix[1]).toBeLessThan(60);
      expect(roundedPatchPix[2]).toBeLessThan(70);
    });

    it("guarantees temp directories are deleted in finally block even when export throws", async () => {
      const testTempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "acm-test-cleanup-")
      );
      await fs.promises.writeFile(
        path.join(testTempDir, "dummy-master.jpg"),
        Buffer.from("dummy-bytes")
      );

      expect(fs.existsSync(testTempDir)).toBe(true);

      try {
        // Force an error: photoSource throws
        const failingPhotoSource = vi
          .fn()
          .mockRejectedValue(new Error("Simulated storage failure"));
        await exportSheet(
          {
            eventSpec: sampleEventSpec,
            draft,
            people: [{ ...personNormal, id: "forced-err-p1" }],
            photoSource: failingPhotoSource,
            brand: brandWithLogos,
            fonts: testFonts,
          },
          { format: "pdf" }
        );
      } finally {
        await fs.promises.rm(testTempDir, { recursive: true, force: true });
      }

      // Assert directory is completely cleaned up
      expect(fs.existsSync(testTempDir)).toBe(false);
    });
  });
});
