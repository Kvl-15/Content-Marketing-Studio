// @ts-check

import { UNKNOWN_ROLE_ID } from "./constants.js";
import { DataRowError } from "./errors.js";

/** @param {unknown} value @returns {string} */
function comparable(value) {
  return String(value ?? "").normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * Resolves either an event role ID or its human-facing label. IDs are checked
 * exactly first; labels use normalized comparison for import-friendly input.
 * @param {unknown} value
 * @param {{roles?: Array<{id: string, label?: string}>}} eventSpec
 * @param {{rowNumber?: number}} [options]
 * @returns {{roleId: string|null, issue?: object}}
 */
export function resolveRole(value, eventSpec, options = {}) {
  const roles = Array.isArray(eventSpec?.roles) ? eventSpec.roles : [];
  const exact = roles.find((role) => role.id === value);
  const comparableValue = comparable(value);
  const matches = roles.filter((role) => comparable(role.id) === comparableValue || comparable(role.label) === comparableValue);
  const role = exact ?? (matches.length === 1 ? matches[0] : undefined);
  if (role) return { roleId: role.id };
  const missing = comparableValue.length === 0;
  const issue = {
    code: UNKNOWN_ROLE_ID,
    severity: "error",
    rowNumber: options.rowNumber,
    value: value ?? "",
    message: missing ? "Role is missing" : `Unknown role ID or label: ${String(value ?? "")}`,
  };
  return { roleId: null, issue };
}

export const resolveRoleId = resolveRole;

/** @param {Array<Record<string, unknown>>} rows @param {{roles?: Array<{id: string, label?: string}>}} eventSpec @param {{roleField?: string}} [options] */
export function resolveRoles(rows, eventSpec, options = {}) {
  const roleField = options.roleField ?? "roleId";
  const issues = [];
  const resolved = rows.map((row, index) => {
    const result = resolveRole(row[roleField], eventSpec, { rowNumber: index + 1 });
    if (result.issue) issues.push(result.issue);
    return result.roleId ? { ...row, [roleField]: result.roleId } : { ...row };
  });
  return { rows: resolved, issues };
}

/** @param {unknown} value @param {{roles?: Array<{id: string, label?: string}>}} eventSpec */
export function requireRoleId(value, eventSpec) {
  const result = resolveRole(value, eventSpec);
  if (!result.roleId) throw new DataRowError(result.issue.message, UNKNOWN_ROLE_ID, result.issue);
  return result.roleId;
}
