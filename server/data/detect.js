// @ts-check

import { TextDecoder } from "node:util";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { DATA_LIMITS } from "./limits.js";
import { SUPPORTED_DELIMITERS } from "./constants.js";
import { DataParseError, DataValidationError, UnsupportedFormatError } from "./errors.js";
import { detectDelimiter, parseDelimited } from "./csv.js";
import { detectHeaderRow } from "./headers.js";

/** @param {string|Uint8Array|ArrayBuffer|Buffer} input */
export function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === "string") return Buffer.from(input, "utf8");
  if (input instanceof Uint8Array) return Buffer.from(input);
  return Buffer.from(new Uint8Array(input));
}

/** @param {string|Uint8Array|ArrayBuffer|Buffer} input */
export function inputToText(input) {
  const buffer = toBuffer(input);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw new UnsupportedFormatError("Input is not valid UTF-8 text", { cause: String(error) });
  }
}

/** @param {string} text */
export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** @param {Buffer} buffer */
function isXlsxBuffer(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;
  const sample = buffer.toString("latin1");
  return sample.includes("[Content_Types].xml") || sample.includes("xl/");
}

/** @param {Buffer} buffer */
function looksBinary(buffer) {
  if (buffer.includes(0)) return true;
  let controls = 0;
  for (const byte of buffer) {
    if ((byte < 7 || (byte > 14 && byte < 32)) && byte !== 9 && byte !== 10 && byte !== 13) controls += 1;
  }
  return buffer.length > 0 && controls / buffer.length > 0.02;
}

/** @param {string|Uint8Array|ArrayBuffer|Buffer} input */
export function detectFormat(input) {
  const buffer = toBuffer(input);
  if (buffer.length === 0) return { format: "unknown", reason: "empty input" };
  if (isXlsxBuffer(buffer)) return { format: "xlsx", reason: "ZIP contains XLSX parts" };
  const text = stripBom(inputToText(buffer));
  const first = text.trimStart();
  if (!first) return { format: "unknown", text, reason: "empty input" };
  if (first.startsWith("{") || first.startsWith("[")) {
    try {
      JSON.parse(first);
      return { format: "json", text, reason: "valid JSON" };
    } catch {
      return { format: "json", text, reason: "JSON-shaped input" };
    }
  }
  if (looksBinary(buffer)) return { format: "unknown", text, reason: "binary-looking input" };
  const sample = first.split(/\r?\n/u).slice(0, 12).join("\n");
  if (SUPPORTED_DELIMITERS.some((delimiter) => sample.includes(delimiter))) {
    return { format: "csv", text, reason: "delimited text" };
  }
  return { format: "unknown", text, reason: "no tabular signature" };
}

export const detectInputFormat = detectFormat;
export const detectFileType = detectFormat;

/** @param {string} text */
export function parseJson(text) {
  try {
    return JSON.parse(stripBom(text));
  } catch (error) {
    throw new DataParseError("Invalid JSON input", { cause: String(error) });
  }
}

/** @param {any} value */
function jsonRows(value) {
  const rows = value && !Array.isArray(value) && Array.isArray(value.rows) ? value.rows : value;
  if (!Array.isArray(rows)) throw new DataValidationError("JSON input must be an array of row objects or arrays");
  if (rows.length === 0) return [];
  if (rows.every((row) => Array.isArray(row))) return rows.map((row) => row.map((cell) => cell ?? ""));
  if (rows.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
    const headers = [];
    for (const row of rows) for (const key of Object.keys(row)) if (!headers.includes(key)) headers.push(key);
    return [headers, ...rows.map((row) => headers.map((key) => row[key] ?? ""))];
  }
  throw new DataValidationError("JSON rows must all be objects or all be arrays");
}

/** @param {Buffer} buffer */
function parseXlsx(buffer) {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer", dense: true, cellFormula: false, cellHTML: false, cellNF: false, cellStyles: false, WTF: false });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new DataValidationError("XLSX workbook has no sheets");
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: true });
    return { rows, sheetName: firstSheetName };
  } catch (error) {
    if (error instanceof DataValidationError) throw error;
    throw new DataParseError("Invalid XLSX workbook", { cause: String(error) });
  }
}

/**
 * Parse an input into a two-dimensional table. Header discovery is deliberately
 * separate so callers can display mapping proposals before building a dataset.
 * @param {string|Uint8Array|ArrayBuffer|Buffer} input
 * @param {{maxBytes?:number}} [options]
 */
export function parseInput(input, options = {}) {
  const buffer = toBuffer(input);
  const maxBytes = options.maxBytes ?? DATA_LIMITS.maxInputBytes;
  if (buffer.length === 0) throw new UnsupportedFormatError("Input file is empty");
  if (buffer.length > maxBytes) throw new UnsupportedFormatError("Input file exceeds the configured size limit", { maxBytes });
  const detected = detectFormat(buffer);
  if (detected.format === "unknown") throw new UnsupportedFormatError("Input is empty, binary, or not clearly tabular", detected);
  if (detected.format === "xlsx") return { ...parseXlsx(buffer), format: "xlsx", firstSheet: true };
  if (detected.format === "json") return { rows: jsonRows(parseJson(detected.text ?? "")), format: "json" };
  const text = detected.text ?? inputToText(buffer);
  const delimiter = detectDelimiter(text);
  const parsed = Papa.parse(text, { delimiter, newline: "", quoteChar: '"', escapeChar: '"', skipEmptyLines: false, dynamicTyping: false });
  if (parsed.errors.length > 0) throw new DataParseError("Invalid CSV input", { errors: parsed.errors });
  const rows = parsed.data
    .filter((row) => Array.isArray(row))
    .map((row) => row.map((cell) => cell ?? ""))
    .filter((row) => row.some((cell) => String(cell).trim() !== ""));
  return { rows, format: "csv", delimiter };
}

export const parseData = parseInput;
export const assertSupportedTextInput = parseInput;
export { detectDelimiter, parseDelimited };

/** Parse and detect the header row in one call. */
export function parseTableInput(input, options = {}) {
  const parsed = parseInput(input, options);
  const header = detectHeaderRow(parsed.rows);
  return { ...parsed, ...header };
}
