// @ts-check
import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { deflateRawSync } from "node:zlib";
import {
  cropToSlot,
  imageInfo,
  ingestPhotoZip,
  matchPhotosToRows,
  processPhoto,
  safeZipPath,
} from "./photos.js";

function png(width, height) {
  const out = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(out);
  out.writeUInt32BE(13, 8); out.write("IHDR", 12, "ascii");
  out.writeUInt32BE(width, 16); out.writeUInt32BE(height, 20);
  return out;
}

function jpeg(width, height) {
  const out = Buffer.alloc(23);
  out.writeUInt16BE(0xffd8, 0); out.writeUInt16BE(0xffc0, 2); out.writeUInt16BE(17, 4);
  out[6] = 8; out.writeUInt16BE(height, 7); out.writeUInt16BE(width, 9); out[11] = 3;
  out[12] = 1; out[13] = 0x11; out[14] = 0; out[15] = 2; out[16] = 0x11; out[17] = 0; out[18] = 3; out[19] = 0x11; out[20] = 0;
  out[21] = 0xff; out[22] = 0xd9;
  return out;
}

function zip(entries) {
  const table = (() => { const t = []; for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (data) => { let c = 0xffffffff; for (const byte of data) c = table[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const locals = []; const centrals = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name); const body = entry.compress ? deflateRawSync(entry.data) : entry.data;
    const local = Buffer.alloc(30 + name.length); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.compress ? 8 : 0, 8); local.writeUInt32LE(crc32(entry.data), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(entry.declaredUncompressedSize ?? entry.data.length, 22);
    local.writeUInt16LE(name.length, 26); name.copy(local, 30); locals.push(Buffer.concat([local, body]));
    const central = Buffer.alloc(46 + name.length); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.compress ? 8 : 0, 10); central.writeUInt32LE(crc32(entry.data), 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(entry.declaredUncompressedSize ?? entry.data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42); name.copy(central, 46); centrals.push(central); offset += local.length + body.length;
  }
  const central = Buffer.concat(centrals); const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, eocd]);
}

describe("photo ZIP ingestion", () => {
  it("accepts a stream without buffering the complete ZIP in the caller", async () => {
    const archive = zip([{ name: "stream.png", data: png(10, 10), compress: true }]);
    const result = await ingestPhotoZip(Readable.from([archive.subarray(0, 7), archive.subarray(7)]));
    expect(result.photos).toHaveLength(1);
  });

  it("rejects traversal, accepts JPEG/PNG/WebP-shaped entries, and reports corrupt files", async () => {
    const webp = Buffer.alloc(30); webp.write("RIFF", 0); webp.writeUInt32LE(22, 4); webp.write("WEBP", 8); webp.write("VP8X", 12); webp.writeUInt32LE(10, 16); webp[24] = 99; webp[27] = 59;
    const result = await ingestPhotoZip(zip([
      { name: "../escape.png", data: png(10, 10) },
      { name: "a.png", data: png(10, 20), compress: true },
      { name: "c.jpeg", data: jpeg(20, 10) },
      { name: "b.webp", data: webp },
      { name: "bad.jpg", data: Buffer.from("not an image") },
    ]));
    expect(result.photos.map((photo) => photo.filename)).toEqual(["a.png", "c.jpeg", "b.webp"]);
    expect(result.warnings.map((item) => item.code)).toEqual(["ZIP_PATH_TRAVERSAL", "PHOTO_UNSUPPORTED_OR_CORRUPT"]);
  });

  it("enforces entry, total, and pixel limits without throwing", async () => {
    const result = await ingestPhotoZip(zip([{ name: "huge.png", data: png(100, 100) }]), { maxPixels: 99, maxEntryBytes: 10 });
    expect(result.photos).toHaveLength(0);
    expect(result.warnings.some((item) => item.code === "ZIP_ENTRY_LIMIT")).toBe(true);
    const total = await ingestPhotoZip(zip([{ name: "one.png", data: png(2, 2) }, { name: "two.png", data: png(2, 2) }]), { maxTotalBytes: 34 });
    expect(total.photos).toHaveLength(1);
    expect(total.warnings.some((item) => item.code === "ZIP_TOTAL_LIMIT")).toBe(true);
  });

  it("counts decompressed bytes instead of trusting an understated ZIP header", async () => {
    const result = await ingestPhotoZip(zip([{ name: "understated.png", data: png(2, 2), declaredUncompressedSize: 1, compress: true }]), { maxEntryBytes: 10 });
    expect(result.photos).toHaveLength(0);
    expect(result.warnings.some((item) => item.code === "ZIP_ENTRY_LIMIT")).toBe(true);
  });

  it("handles empty ZIPs, zero-byte images, and corrupt JPEGs as warnings", async () => {
    await expect(ingestPhotoZip(zip([]))).resolves.toMatchObject({ photos: [], warnings: [] });
    const result = await ingestPhotoZip(zip([
      { name: "empty.jpg", data: Buffer.alloc(0) },
      { name: "corrupt.jpeg", data: Buffer.from([0xff, 0xd8, 0xff]) },
    ]));
    expect(result.photos).toHaveLength(0);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.every((item) => item.code === "PHOTO_UNSUPPORTED_OR_CORRUPT")).toBe(true);
  });

  it("bounds a 300-entry archive with configurable small limits", async () => {
    const entries = Array.from({ length: 300 }, (_, index) => ({ name: `photo-${index}.png`, data: png(1, 1) }));
    const result = await ingestPhotoZip(zip(entries), { maxEntries: 3, maxEntryBytes: 33, maxEntryCompressedBytes: 33, maxTotalBytes: 99 });
    expect(result.photos).toHaveLength(3);
    expect(result.warnings.some((item) => item.code === "ZIP_ENTRY_LIMIT")).toBe(true);
  });
});

describe("photo geometry and matching", () => {
  it("uses centered horizontal and top-biased vertical cover crops", () => {
    expect(cropToSlot({ width: 1000, height: 1000 }, { ratio: 1.5 })).toMatchObject({ left: 0, top: 0, width: 1000, height: 667 });
    expect(cropToSlot({ width: 1600, height: 900 }, { ratio: 1 })).toMatchObject({ left: 350, top: 0, width: 900, height: 900 });
  });

  it("matches by ID, email, and filename and reports both unmatched sides", () => {
    const photos = [{ filename: "P-1.jpg" }, { filename: "person@example.com.png" }, { filename: "orphan.webp" }];
    const result = matchPhotosToRows([{ id: "P-1" }, { email: "person@example.com" }, { filename: "missing.jpg" }], photos);
    expect(result.matches).toHaveLength(2); expect(result.unmatchedRows).toHaveLength(1); expect(result.unmatchedFiles).toHaveLength(1);
  });

  it("has image dimensions and uses Sharp's rotate, sRGB, cover, and JPEG pipeline", async () => {
    expect(imageInfo(png(12, 8))).toMatchObject({ width: 12, height: 8, format: "png" });
    const calls = []; const pipeline = {
      rotate: () => { calls.push("rotate"); return pipeline; },
      toColourspace: (value) => { calls.push(["colourspace", value]); return pipeline; },
      resize: (...args) => { calls.push(["resize", ...args]); return pipeline; },
      jpeg: (value) => { calls.push(["jpeg", value]); return pipeline; },
      toBuffer: async () => Buffer.from("jpeg"),
    };
    const result = await processPhoto(png(100, 200), { sharp: () => pipeline, slot: { widthMm: 25.4, heightMm: 50.8 }, dpi: 100 });
    expect(result.mimeType).toBe("image/jpeg"); expect(result.width).toBe(100); expect(result.height).toBe(200);
    expect(calls[0]).toBe("rotate"); expect(calls[1]).toEqual(["colourspace", "srgb"]); expect(calls[2]).toMatchObject(["resize", 100, 200, { fit: "cover", position: "north" }]);
  });

  it("normalizes a real image, removes EXIF metadata, and returns effective DPI", async () => {
    const sharp = (await import("sharp")).default;
    const source = await sharp({
      create: { width: 600, height: 1000, channels: 3, background: { r: 240, g: 30, b: 30 } },
    }).jpeg({ withMetadata: { orientation: 6, density: 72 } }).toBuffer();
    const result = await processPhoto(source, { slot: { widthMm: 54, heightMm: 85.6 }, dpi: 200, topBias: 0.2 });
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.width).toBe(Math.round(54 / 25.4 * 200));
    expect(metadata.height).toBe(Math.round(85.6 / 25.4 * 200));
    expect(result.effectiveDpi).toBeGreaterThan(200);
  });
});

describe("ZIP path safety", () => {
  it.each(["../x.jpg", "/x.jpg", "C:/x.jpg", "foo/../../x.jpg"])("rejects %s", (path) => expect(safeZipPath(path)).toBeNull());
});
