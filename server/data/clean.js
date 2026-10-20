// @ts-check

import { ROW_ISSUES } from "./constants.js";

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/gu;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;
const FORMULA_LIKE = /^\s*[=+\-@]/u;

/**
 * Normalizes a cell without changing its semantic value. NFC is applied before
 * whitespace normalization so canonically equivalent names produce equal IDs.
 * @param {unknown} value
 * @returns {string}
 */
export function cleanCell(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFC")
    .replace(ZERO_WIDTH, "")
    .replace(CONTROL, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** @param {unknown} value */
export function cleanCellDetails(value) {
  const original = value === null || value === undefined ? "" : String(value);
  const normalized = original.normalize("NFC");
  const withoutZeroWidth = normalized.replace(ZERO_WIDTH, "");
  const withoutControls = withoutZeroWidth.replace(CONTROL, "");
  const cleaned = withoutControls.replace(/\s+/gu, " ").trim();
  return {
    value: cleaned,
    removedControlCharacters: withoutControls !== withoutZeroWidth,
    removedZeroWidthCharacters: withoutZeroWidth !== normalized,
    changed: cleaned !== original,
  };
}

/** @param {unknown} value @returns {boolean} */
export function isFormulaLikeCell(value) {
  return typeof value === "string" && FORMULA_LIKE.test(value);
}

/** @param {Array<unknown>} values @returns {number} */
export function countFormulaLikeCells(values) {
  return values.reduce((count, value) => count + (isFormulaLikeCell(value) ? 1 : 0), 0);
}

export const cleanValue = cleanCell;

/**
 * @param {Record<string, unknown>} row
 * @returns {{row: Record<string, string>, formulaLikeCount: number, issues: Array<object>}}
 */
export function cleanRow(row) {
  const cleaned = {};
  let formulaLikeCount = 0;
  const issues = [];
  for (const [key, value] of Object.entries(row)) {
    const detail = cleanCellDetails(value);
    const cell = detail.value;
    cleaned[cleanCell(key)] = cell;
    if (isFormulaLikeCell(cell)) formulaLikeCount += 1;
    if (detail.removedControlCharacters || detail.removedZeroWidthCharacters) {
      issues.push({ code: ROW_ISSUES.CONTROL_CHARACTERS_REMOVED, severity: "warning" });
    }
  }
  return {
    row: cleaned,
    formulaLikeCount,
    issues:
      formulaLikeCount > 0
        ? [{ code: ROW_ISSUES.FORMULA_LIKE_CELL, severity: "warning", count: formulaLikeCount }, ...issues]
        : issues,
  };
}

/**
 * Cleans all rows and retains deterministic source row numbers.
 * @param {Array<Record<string, unknown>>} rows
 */
export function cleanRows(rows) {
  let formulaLikeCount = 0;
  const issues = [];
  const cleanedRows = rows.map((row, index) => {
    const result = cleanRow(row);
    formulaLikeCount += result.formulaLikeCount;
    for (const issue of result.issues) issues.push({ ...issue, rowNumber: index + 1 });
    return result.row;
  });
  return { rows: cleanedRows, formulaLikeCount, issues };
}

export const cleanDataRows = cleanRows;
