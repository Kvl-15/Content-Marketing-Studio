// @ts-check

import yauzl from "yauzl";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";
import { DATA_LIMITS } from "./limits.js";

export const DEFAULT_PHOTO_LIMITS = Object.freeze({
  maxEntries: DATA_LIMITS.maxPhotoEntries,
  maxEntryCompressedBytes: DATA_LIMITS.maxPhotoEntryCompressedBytes,
  maxEntryBytes: DATA_LIMITS.maxPhotoEntryUncompressedBytes,
  maxTotalBytes: DATA_LIMITS.maxPhotoTotalUncompressedBytes,
  maxPixels: DATA_LIMITS.maxPhotoPixels,
  maxZipBytes: DATA_LIMITS.maxZipBytes,
});

/** @param {string} name */
export function safeZipPath(name) {
  const value = String(name).replaceAll("\\", "/");
  if (!value || value.startsWith("/") || /^[A-Za-z]:\//u.test(value)) return null;
  const parts = value.split("/");
  if (parts.some((part) => part === "..")) return null;
  const clean = parts.filter((part) => part && part !== ".");
  return clean.length ? clean.join("/") : null;
}

/** @param {Buffer} data */
function jpegDimensions(data) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) { offset += 1; continue; }
    while (data[offset] === 0xff) offset += 1;
    const marker = data[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > data.length) return null;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) return null;
    if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 7) {
      const height = data.readUInt16BE(offset + 3);
      const width = data.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height, format: "jpeg", mimeType: "image/jpeg" } : null;
    }
    offset += length;
  }
  return null;
}

/** @param {Buffer} data */
function pngDimensions(data) {
  if (data.length < 24 || data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  if (data.readUInt32BE(8) !== 13 || data.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  const width = data.readUInt32BE(16); const height = data.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height, format: "png", mimeType: "image/png" } : null;
}

/** @param {Buffer} data */
function webpDimensions(data) {
  if (data.length < 30 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = data.toString("ascii", 12, 16);
  if (chunk === "VP8X" && data.length >= 30) {
    const width = 1 + data.readUIntLE(24, 3); const height = 1 + data.readUIntLE(27, 3);
    return { width, height, format: "webp", mimeType: "image/webp" };
  }
  if (chunk === "VP8 " && data.length >= 34 && data.toString("hex", 26, 29) === "9d012a") {
    const width = data.readUInt16LE(30) & 0x3fff; const height = data.readUInt16LE(32) & 0x3fff;
    return width && height ? { width, height, format: "webp", mimeType: "image/webp" } : null;
  }
  if (chunk === "VP8L" && data.length >= 25 && data[20] === 0x2f) {
    const width = 1 + ((data[21] | (data[22] << 8)) & 0x3fff);
    const height = 1 + (((data[22] >> 6) | (data[23] << 2) | (data[24] << 10)) & 0x3fff);
    return { width, height, format: "webp", mimeType: "image/webp" };
  }
  return null;
}

/** @param {Buffer|Uint8Array} input */
export function imageInfo(input) {
  const data = Buffer.from(input);
  return jpegDimensions(data) ?? pngDimensions(data) ?? webpDimensions(data);
}

/** @param {Buffer|Uint8Array} input @param {number} [maxPixels] */
export function assertImagePixels(input, maxPixels = DATA_LIMITS.maxImagePixels) {
  const info = imageInfo(input);
  if (!info) throw new Error("unsupported or corrupt image");
  if (info.width * info.height > maxPixels) throw new Error(`image exceeds ${maxPixels} pixel limit`);
  return info;
}

class PhotoLimitError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** @param {any} input */
function isReadableInput(input) {
  return input && (typeof input[Symbol.asyncIterator] === "function" || typeof input.on === "function");
}

/**
 * Spool an upload stream to a temporary file. This keeps the ZIP itself out of
 * memory while still giving yauzl the random access it needs for the central
 * directory.
 * @param {any} input
 * @param {number} maxBytes
 */
async function spoolReadable(input, maxBytes) {
  const directory = await mkdtemp(join(tmpdir(), "photo-zip-"));
  const filePath = join(directory, "archive.zip");
  let handle;
  try {
    handle = await open(filePath, "w");
    let total = 0;
    for await (const chunk of input) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > maxBytes) throw new PhotoLimitError("ZIP_SIZE_LIMIT", "ZIP exceeds the configured compressed size limit");
      await handle.write(bytes);
    }
    await handle.close();
    handle = undefined;
    return { filePath, directory };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/** @param {string} filePath @param {number} maxZipBytes */
async function openPathZip(filePath, maxZipBytes) {
  const details = await stat(filePath);
  if (details.size > maxZipBytes) throw new PhotoLimitError("ZIP_SIZE_LIMIT", "ZIP exceeds the configured compressed size limit");
  return new Promise((resolve, reject) => {
    open(filePath, "r").then((handle) => {
      yauzl.fromFd(handle.fd, {
        lazyEntries: true,
        autoClose: false,
        validateEntrySizes: false,
        strictFileNames: false,
        decodeStrings: false,
      }, (error, zipfile) => {
        if (error || !zipfile) {
          handle.close().catch(() => {});
          reject(error ?? new Error("ZIP could not be opened"));
          return;
        }
        resolve({
          zipfile,
          close: async () => {
            if (zipfile.isOpen) {
              const closed = new Promise((done) => zipfile.once("close", done));
              zipfile.close();
              await closed;
            }
            await handle.close().catch(() => {});
          },
        });
      });
    }).catch(reject);
  });
}

/** @param {any} input @param {number} maxZipBytes */
async function openPhotoZip(input, maxZipBytes) {
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
    if (data.length > maxZipBytes) throw new PhotoLimitError("ZIP_SIZE_LIMIT", "ZIP exceeds the configured compressed size limit");
    return new Promise((resolve, reject) => {
      yauzl.fromBuffer(data, {
        lazyEntries: true,
        validateEntrySizes: false,
        strictFileNames: false,
        decodeStrings: false,
      }, (error, zipfile) => error || !zipfile ? reject(error ?? new Error("ZIP could not be opened")) : resolve({ zipfile, close: async () => {} }));
    });
  }
  if (typeof input === "string") return openPathZip(input, maxZipBytes);
  if (input?.reader && Number.isFinite(input.totalSize)) {
    if (input.totalSize > maxZipBytes) throw new PhotoLimitError("ZIP_SIZE_LIMIT", "ZIP exceeds the configured compressed size limit");
    return new Promise((resolve, reject) => {
      yauzl.fromRandomAccessReader(input.reader, input.totalSize, {
        lazyEntries: true,
        validateEntrySizes: false,
        strictFileNames: false,
        decodeStrings: false,
      }, (error, zipfile) => error || !zipfile ? reject(error ?? new Error("ZIP could not be opened")) : resolve({ zipfile, close: async () => {} }));
    });
  }
  if (!isReadableInput(input)) throw new Error("photo ZIP must be a path, buffer, stream, or random-access reader");
  const temporary = await spoolReadable(input, maxZipBytes);
  try {
    const result = await openPathZip(temporary.filePath, maxZipBytes);
    return { ...result, close: async () => { await result.close(); await rm(temporary.directory, { recursive: true, force: true }); } };
  } catch (error) {
    await rm(temporary.directory, { recursive: true, force: true });
    throw error;
  }
}

/** @param {any} zipfile @param {any} entry @param {any} limits @param {number} totalBytes */
async function readEntryBytes(zipfile, entry, limits, totalBytes) {
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) throw new Error(`unsupported ZIP compression method: ${entry.compressionMethod}`);
  const raw = await zipfile.openReadStreamPromise(entry, { decodeFileData: false });
  const chunks = [];
  let compressedBytes = 0;
  let uncompressedBytes = 0;
  const compressedCounter = new Transform({
    transform(chunk, encoding, callback) {
      compressedBytes += chunk.length;
      if (compressedBytes > limits.maxEntryCompressedBytes) {
        callback(new PhotoLimitError("ZIP_ENTRY_LIMIT", "ZIP entry exceeds its compressed size limit"));
        return;
      }
      callback(null, chunk);
    },
  });
  const decodedCounter = new Transform({
    transform(chunk, encoding, callback) {
      uncompressedBytes += chunk.length;
      if (uncompressedBytes > limits.maxEntryBytes) {
        callback(new PhotoLimitError("ZIP_ENTRY_LIMIT", "ZIP entry exceeds its uncompressed size limit"));
        return;
      }
      if (totalBytes + uncompressedBytes > limits.maxTotalBytes) {
        callback(new PhotoLimitError("ZIP_TOTAL_LIMIT", "ZIP exceeds uncompressed size limit"));
        return;
      }
      chunks.push(chunk);
      // This is the terminal stream in the pipeline. Do not emit the chunk
      // again: an unconsumed Transform readable side would eventually apply
      // backpressure and stall on real multi-megabyte photos.
      callback();
    },
  });
  const streams = [raw, compressedCounter];
  if (entry.compressionMethod === 8) streams.push(createInflateRaw());
  streams.push(decodedCounter);
  await pipeline(...streams);
  return { bytes: Buffer.concat(chunks), uncompressedBytes };
}

/**
 * Read photos with yauzl's lazy entry mode. No archive path is ever used as an
 * output path without validation, and oversized entries are never decompressed.
 * @param {string|Buffer|Uint8Array|AsyncIterable<Buffer>|{reader:any,totalSize:number}} input
 * @param {Partial<typeof DEFAULT_PHOTO_LIMITS> & {maxZipBytes?:number}} [options]
 */
export async function ingestPhotoZip(input, options = {}) {
  const limits = { ...DEFAULT_PHOTO_LIMITS, ...options };
  const result = { photos: [], warnings: [] };
  let opened;
  try {
    opened = await openPhotoZip(input, limits.maxZipBytes);
    let totalBytes = 0;
    let count = 0;
    try {
      for await (const entry of opened.zipfile.eachEntry()) {
        count += 1;
        if (count > limits.maxEntries) {
          result.warnings.push({ code: "ZIP_ENTRY_LIMIT", message: `ZIP has more than ${limits.maxEntries} entries` });
          opened.zipfile.close();
          break;
        }
        const entryName = Buffer.isBuffer(entry.fileName) ? entry.fileName.toString("utf8") : String(entry.fileName);
        const path = safeZipPath(entryName);
        if (!path) {
          result.warnings.push({ code: "ZIP_PATH_TRAVERSAL", file: entryName, message: "Unsafe ZIP path" });
          continue;
        }
        if (/\/$/u.test(path)) continue;
        if (!/\.(?:jpe?g|png|webp)$/iu.test(path)) {
          result.warnings.push({ code: "UNSUPPORTED_PHOTO_FORMAT", file: path, message: "Only JPEG, PNG, and WebP photos are supported" });
          continue;
        }
        if (entry.compressedSize > limits.maxEntryCompressedBytes) {
          result.warnings.push({ code: "ZIP_ENTRY_LIMIT", file: path, message: "ZIP entry exceeds its declared compressed-size limit" });
          continue;
        }
        try {
          const read = await readEntryBytes(opened.zipfile, entry, limits, totalBytes);
          totalBytes += read.uncompressedBytes;
          const info = imageInfo(read.bytes);
          if (!info) throw new Error("unsupported or corrupt image");
          if (info.width * info.height > limits.maxPixels) throw new Error(`image exceeds ${limits.maxPixels} pixel limit`);
          result.photos.push({ filename: path.split("/").pop() ?? path, path, buffer: read.bytes, ...info });
        } catch (error) {
          const message = error instanceof Error ? error.message : "could not read photo";
          const code = error instanceof PhotoLimitError ? error.code : message.includes("pixel") ? "PHOTO_PIXEL_LIMIT" : "PHOTO_UNSUPPORTED_OR_CORRUPT";
          result.warnings.push({ code, file: path, message });
        }
      }
    } catch (error) {
      result.warnings.push({ code: "ZIP_CORRUPT", message: error instanceof Error ? error.message : "ZIP entry could not be read" });
    }
  } catch (error) {
    result.warnings.push({
      code: error instanceof PhotoLimitError ? error.code : "ZIP_CORRUPT",
      message: error instanceof Error ? error.message : "ZIP is corrupt or unsupported",
    });
  } finally {
    if (opened) await opened.close();
  }
  return result;
}

/** @param {string} value */
function key(value) { return String(value ?? "").normalize("NFC").trim().toLowerCase(); }
/** @param {string} value */
function stem(value) { return String(value).replaceAll("\\", "/").split("/").pop()?.replace(/\.(?:jpe?g|png|webp)$/iu, "") ?? ""; }

/** @param {Array<Record<string, any>>} rows @param {Array<Record<string, any>>} photos */
export function matchPhotosToRows(rows, photos) {
  const used = new Set(); const matches = []; const unmatchedRows = []; const warnings = [];
  rows.forEach((row, rowIndex) => {
    const candidates = [row.id, row.email, row.photo, row.filename, row.photoFilename].map((value) => key(stem(String(value ?? "")))).filter(Boolean);
    const found = photos.map((photo, index) => ({ photo, index })).filter(({ photo, index }) => !used.has(index) && candidates.some((candidate) => candidate === key(stem(photo.filename)) || candidate === key(stem(photo.path))));
    if (found.length === 1) { used.add(found[0].index); matches.push({ rowIndex, row, photo: found[0].photo, photoIndex: found[0].index }); }
    else { unmatchedRows.push({ rowIndex, row }); if (found.length > 1) warnings.push({ code: "PHOTO_MATCH_AMBIGUOUS", rowIndex, message: "More than one photo matched this row" }); }
  });
  return { matches, unmatchedRows, unmatchedFiles: photos.filter((_, index) => !used.has(index)), warnings };
}

/**
 * Calculate a cover crop. The overload with widthMm/heightMm/dpi is the public
 * pipeline API; the object form remains useful for callers that only need geometry.
 */
export function cropToSlot(source, slotOrWidth, heightOrOptions, dpi = 300, bias = DATA_LIMITS.defaultCropBias) {
  const legacy = typeof slotOrWidth === "object";
  const slot = legacy ? slotOrWidth : { widthMm: slotOrWidth, heightMm: heightOrOptions };
  const ratio = "ratio" in slot ? slot.ratio : slot.widthMm / slot.heightMm;
  if (!(source.width > 0 && source.height > 0) || !(ratio > 0)) throw new RangeError("invalid source or slot dimensions");
  const sourceRatio = source.width / source.height;
  const topBias = Math.min(0.5, Math.max(0, legacy ? (heightOrOptions?.topBias ?? 0) : bias));
  let crop;
  if (sourceRatio > ratio) {
    const width = Math.max(1, Math.round(source.height * ratio));
    crop = { left: Math.round((source.width - width) / 2), top: 0, width, height: source.height };
  } else {
    const height = Math.max(1, Math.round(source.width / ratio));
    crop = { left: 0, top: Math.round((source.height - height) * topBias), width: source.width, height };
  }
  if (legacy) return { ...crop, ratio };
  const outputWidth = Math.max(1, Math.round(slot.widthMm / 25.4 * dpi));
  const outputHeight = Math.max(1, Math.round(slot.heightMm / 25.4 * dpi));
  return { ...crop, outputWidth, outputHeight, effectiveDpi: Math.min(crop.width / (slot.widthMm / 25.4), crop.height / (slot.heightMm / 25.4)), ratio };
}

/** @param {any} imported */
function sharpFactory(imported) { return imported?.default ?? imported; }

/** @param {Buffer|Uint8Array} input @param {{slot?:{widthMm:number,heightMm:number},dpi?:number,bias?:number,topBias?:number,maxPixels?:number,sharp?:Function,quality?:number}} [options] */
export async function processPhoto(input, options = {}) {
  const maxPixels = options.maxPixels ?? DATA_LIMITS.maxImagePixels;
  const source = assertImagePixels(input, maxPixels);
  const slot = options.slot ?? { widthMm: 54, heightMm: 85.6 };
  const crop = cropToSlot(source, slot.widthMm, slot.heightMm, options.dpi ?? 300, options.bias ?? options.topBias ?? DATA_LIMITS.defaultCropBias);
  const factory = options.sharp ?? sharpFactory(await import("sharp"));
  if (typeof factory.cache === "function") factory.cache(false);
  let pipeline = factory(Buffer.from(input), { limitInputPixels: maxPixels }).rotate();
  if (typeof pipeline.toColorspace === "function") pipeline = pipeline.toColorspace("srgb");
  else if (typeof pipeline.toColourspace === "function") pipeline = pipeline.toColourspace("srgb");
  if (typeof pipeline.extract === "function") {
    pipeline = pipeline.extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height });
  }
  pipeline = pipeline.resize(crop.outputWidth, crop.outputHeight, { fit: "cover", position: "north" }).jpeg({ quality: options.quality ?? DATA_LIMITS.jpegQuality, mozjpeg: true });
  const buffer = await pipeline.toBuffer();
  return { buffer, mimeType: "image/jpeg", width: crop.outputWidth, height: crop.outputHeight, effectiveDpi: crop.effectiveDpi, crop, source };
}

export const normalizeJpegMaster = processPhoto;
export const matchPhotos = matchPhotosToRows;

/** @param {string} value */
function photoKey(value) { return key(stem(value)); }

/**
 * Stream a ZIP, match each supported entry to a row, normalize it immediately,
 * and write only the current output image. This is the memory-bounded path used
 * by buildDataset; it never returns all decoded photo buffers.
 * @param {string|Buffer|Uint8Array|AsyncIterable<Buffer>|{reader:any,totalSize:number}} input
 * @param {Array<Record<string, any>>} rows
 * @param {{outputDir:string, processOptions?:Record<string, any>, limits?:Partial<typeof DEFAULT_PHOTO_LIMITS>, writePhoto:(row:any, processed:any)=>Promise<string>}} options
 */
export async function processPhotoZip(input, rows, options) {
  const limits = { ...DEFAULT_PHOTO_LIMITS, ...(options.limits ?? {}) };
  const result = { matches: [], unmatchedFiles: [], unmatchedRows: [], warnings: [] };
  const rowKeys = new Map();
  rows.forEach((row, rowIndex) => {
    const candidates = [row.id, row.email, row.photo, row.filename, row.fileName, row.photoFilename]
      .map((value) => photoKey(String(value ?? ""))).filter(Boolean);
    for (const candidate of candidates) {
      const list = rowKeys.get(candidate) ?? [];
      list.push(rowIndex);
      rowKeys.set(candidate, list);
    }
  });
  const matchedRows = new Set();
  const opened = await openPhotoZip(input, limits.maxZipBytes);
  let totalBytes = 0;
  let count = 0;
  try {
    for await (const entry of opened.zipfile.eachEntry()) {
      count += 1;
      if (count > limits.maxEntries) {
        result.warnings.push({ code: "ZIP_ENTRY_LIMIT", message: `ZIP has more than ${limits.maxEntries} entries` });
        opened.zipfile.close();
        break;
      }
      const entryName = Buffer.isBuffer(entry.fileName) ? entry.fileName.toString("utf8") : String(entry.fileName);
      const path = safeZipPath(entryName);
      if (!path) { result.warnings.push({ code: "ZIP_PATH_TRAVERSAL", file: entryName, message: "Unsafe ZIP path" }); continue; }
      if (/\/$/u.test(path)) continue;
      if (!/\.(?:jpe?g|png|webp)$/iu.test(path)) {
        result.warnings.push({ code: "UNSUPPORTED_PHOTO_FORMAT", file: path, message: "Only JPEG, PNG, and WebP photos are supported" });
        continue;
      }
      if (entry.compressedSize > limits.maxEntryCompressedBytes) {
        result.warnings.push({ code: "ZIP_ENTRY_LIMIT", file: path, message: "ZIP entry exceeds its declared compressed-size limit" });
        continue;
      }
      const candidates = [photoKey(path), photoKey(entryName)].filter(Boolean);
      const rowIndices = [...new Set(candidates.flatMap((candidate) => rowKeys.get(candidate) ?? []))];
      let read;
      try {
        read = await readEntryBytes(opened.zipfile, entry, limits, totalBytes);
        totalBytes += read.uncompressedBytes;
      } catch (error) {
        const message = error instanceof Error ? error.message : "could not read photo";
        const code = error instanceof PhotoLimitError ? error.code : "PHOTO_UNSUPPORTED_OR_CORRUPT";
        result.warnings.push({ code, file: path, message });
        continue;
      }
      if (rowIndices.length !== 1 || matchedRows.has(rowIndices[0])) {
        result.unmatchedFiles.push(path);
        if (rowIndices.length > 1) result.warnings.push({ code: "PHOTO_MATCH_AMBIGUOUS", file: path, message: "More than one row matched this photo" });
        continue;
      }
      const rowIndex = rowIndices[0];
      try {
        const info = imageInfo(read.bytes);
        if (!info) throw new Error("unsupported or corrupt image");
        if (info.width * info.height > limits.maxPixels) throw new PhotoLimitError("PHOTO_PIXEL_LIMIT", `image exceeds ${limits.maxPixels} pixel limit`);
        const processed = await processPhoto(read.bytes, { ...(options.processOptions ?? {}), maxPixels: limits.maxPixels });
        const outputPath = await options.writePhoto(rows[rowIndex], processed);
        matchedRows.add(rowIndex);
        result.matches.push({ rowIndex, row: rows[rowIndex], file: path, method: rows[rowIndex].id && photoKey(rows[rowIndex].id) === photoKey(path) ? "id" : rows[rowIndex].email && photoKey(rows[rowIndex].email) === photoKey(path) ? "email" : "filename", outputPath, effectiveDpi: processed.effectiveDpi });
      } catch (error) {
        result.warnings.push({ code: error instanceof PhotoLimitError ? error.code : "PHOTO_UNSUPPORTED_OR_CORRUPT", file: path, message: error instanceof Error ? error.message : "could not process photo" });
      }
    }
  } catch (error) {
    result.warnings.push({ code: "ZIP_CORRUPT", message: error instanceof Error ? error.message : "ZIP entry could not be read" });
  } finally {
    await opened.close();
  }
  result.unmatchedRows = rows.map((row, rowIndex) => ({ rowIndex, row })).filter((item) => !matchedRows.has(item.rowIndex));
  return result;
}
