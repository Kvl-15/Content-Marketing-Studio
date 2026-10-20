// @ts-check

import { SUPPORTED_DELIMITERS } from "./constants.js";
import { DataParseError } from "./errors.js";

/** @param {string} line @param {string} delimiter @returns {number} */
function countDelimiter(line, delimiter) {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && line[index] === delimiter) count += 1;
  }
  return count;
}

/** @param {string} text @returns {string} */
export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/u).find((line) => line.trim() !== "") ?? "";
  const scored = SUPPORTED_DELIMITERS.map((delimiter, index) => ({
    delimiter,
    count: countDelimiter(firstLine, delimiter),
    index,
  }));
  scored.sort((a, b) => b.count - a.count || a.index - b.index);
  return scored[0].count > 0 ? scored[0].delimiter : ",";
}

/**
 * RFC 4180-style parser. Blank physical lines are omitted, but a quoted
 * newline remains part of its field.
 * @param {string} text
 * @param {string} [delimiter]
 * @returns {Array<Array<string>>}
 */
export function parseDelimited(text, delimiter = detectDelimiter(text)) {
  if (!SUPPORTED_DELIMITERS.includes(delimiter)) throw new DataParseError("Unsupported delimiter", { delimiter });
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let rowHasContent = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      rowHasContent = true;
    } else if (!quoted && character === delimiter) {
      row.push(field);
      field = "";
      rowHasContent = true;
    } else if (!quoted && character === "\n") {
      row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
      if (rowHasContent || row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
      rowHasContent = false;
    } else {
      field += character;
      if (character.trim() !== "") rowHasContent = true;
    }
  }
  if (quoted) throw new DataParseError("Unclosed quoted CSV field");
  if (field !== "" || row.length > 0 || rowHasContent) {
    row.push(field);
    if (rowHasContent || row.some((cell) => cell !== "")) rows.push(row);
  }
  return rows;
}

export const parseCsv = parseDelimited;

/** @param {string} text @param {string} [delimiter] */
export function parseTable(text, delimiter) {
  const actualDelimiter = delimiter ?? detectDelimiter(text);
  const rows = parseDelimited(text, actualDelimiter);
  const physicalLines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  const blankLineCount = physicalLines.filter((line) => line.trim() === "").length;
  return { rows, delimiter: actualDelimiter, blankLineCount };
}
