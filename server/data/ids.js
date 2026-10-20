// @ts-check

import { DUPLICATE_EMAIL, DUPLICATE_ID } from "./constants.js";

/** @param {unknown} value */
function key(value) {
  return String(value ?? "").normalize("NFC").trim().toLowerCase();
}

/** @param {string} value */
function roleLetter(value) {
  const match = String(value ?? "").toUpperCase().match(/[A-Z0-9]/u);
  return match?.[0] ?? "P";
}

/** @param {unknown} value */
function safeCode(value) {
  return String(value ?? "EVENT").toUpperCase().replace(/[^A-Z0-9]+/gu, "").slice(0, 12) || "EVENT";
}

/**
 * Stable IDs are based on source order, event code, and resolved role. Existing
 * IDs are preserved exactly after cleaning.
 * @param {Array<Record<string, unknown>>} rows
 * @param {{eventCode?:string, roleField?:string, idField?:string, startNumber?:number}} [options]
 */
export function assignDeterministicIds(rows, options = {}) {
  const idField = options.idField ?? "id";
  const roleField = options.roleField ?? "roleId";
  const startNumber = options.startNumber ?? 1;
  const generatedByRole = new Map();
  const reservedIds = new Set();
  for (const source of rows) {
    const current = String(source[idField] ?? "").trim();
    if (current) reservedIds.add(key(current));
  }
  const result = rows.map((source, index) => {
    const row = { ...source };
    const current = String(row[idField] ?? "").trim();
    if (current) {
      row[idField] = current;
    } else {
      const role = roleLetter(row[roleField]);
      let next = (generatedByRole.get(role) ?? startNumber - 1) + 1;
      let generatedId = `${safeCode(options.eventCode)}-${role}-${String(next).padStart(3, "0")}`;
      while (reservedIds.has(key(generatedId))) {
        next += 1;
        generatedId = `${safeCode(options.eventCode)}-${role}-${String(next).padStart(3, "0")}`;
      }
      generatedByRole.set(role, next);
      row[idField] = generatedId;
      reservedIds.add(key(generatedId));
    }
    row.__sourceRowNumber = index + 1;
    return row;
  });
  const idCounts = new Map();
  const emailCounts = new Map();
  for (const row of result) {
    const id = key(row[idField]);
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    const email = key(row.email);
    if (email) emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
  }
  const issues = [];
  for (const row of result) {
    const rowNumber = row.__sourceRowNumber;
    const id = String(row[idField] ?? "");
    if ((idCounts.get(key(id)) ?? 0) > 1) issues.push({ code: DUPLICATE_ID, severity: "error", rowNumber, field: idField, value: id, message: `Duplicate ID: ${id}` });
    const email = key(row.email);
    if (email && (emailCounts.get(email) ?? 0) > 1) issues.push({ code: DUPLICATE_EMAIL, severity: "warning", rowNumber, field: "email", value: email, message: "Duplicate email address" });
  }
  return { rows: result, issues };
}

export const assignIds = assignDeterministicIds;
export const makeDeterministicId = (row, options = {}) => assignDeterministicIds([row], options).rows[0].id;
