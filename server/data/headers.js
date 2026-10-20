// @ts-check

import { DataValidationError } from "./errors.js";
import { ROW_ISSUES } from "./constants.js";

const FIELD_ALIASES = Object.freeze({
  id: ["id", "person id", "participant id", "record id", "identifier", "registration id"],
  name: ["name", "full name", "participant", "participant name", "person name", "display name"],
  roleId: ["role", "role id", "role label", "role type", "designation", "participant role"],
  org: ["org", "organization", "organisation", "company", "institution", "affiliation"],
  email: ["email", "email id", "email address", "mail", "participant email"],
  photo: ["photo", "photo file", "photo filename", "photo file name", "image", "image filename", "avatar"],
  checkinUrl: ["checkin url", "checkin", "qr url", "qr link"],
});

const REQUIRED_FIELDS = Object.freeze(["name", "roleId"]);

/** @param {unknown} value */
export function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

/** @param {string} normalized @param {string} alias */
function scoreAlias(normalized, alias) {
  const candidate = normalizeHeader(alias);
  if (!normalized || !candidate) return 0;
  if (normalized === candidate) return 1;
  if (normalized.includes(candidate) || candidate.includes(normalized)) return Math.min(normalized.length, candidate.length) / Math.max(normalized.length, candidate.length) * 0.85;
  const tokens = normalized.match(/[a-z]+|\d+/g) ?? [normalized];
  const aliasTokens = candidate.match(/[a-z]+|\d+/g) ?? [candidate];
  const shared = tokens.filter((token) => aliasTokens.includes(token)).length;
  return shared ? 0.55 * shared / Math.max(tokens.length, aliasTokens.length) : 0;
}

/** @param {string} header */
function candidatesForHeader(header) {
  const normalized = normalizeHeader(header);
  return Object.entries(FIELD_ALIASES)
    .map(([target, aliases]) => ({ target, score: Math.max(...aliases.map((alias) => scoreAlias(normalized, alias)), 0) }))
    .filter((candidate) => candidate.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.target.localeCompare(b.target));
}

/** @param {Array<unknown>} headers */
export function findHeaderCollisions(headers) {
  const groups = new Map();
  headers.forEach((value, column) => {
    const source = String(value ?? "");
    const normalized = normalizeHeader(source) || `__empty_${column}`;
    const list = groups.get(normalized) ?? [];
    list.push(column);
    groups.set(normalized, list);
  });
  return [...groups.entries()]
    .filter(([, columns]) => columns.length > 1 || String(headers[columns[0]] ?? "").trim() === "")
    .map(([normalized, columns]) => ({ normalized, columns }));
}

/** @param {Array<Array<unknown>>} rows @param {{maxScanRows?:number}} [options] */
export function detectHeaderRow(rows, options = {}) {
  const scanLimit = Math.min(rows.length, options.maxScanRows ?? 25);
  let best = null;
  for (let index = 0; index < scanLimit; index += 1) {
    const row = rows[index] ?? [];
    const nonEmpty = row.filter((cell) => String(cell ?? "").trim() !== "");
    if (nonEmpty.length === 0) continue;
    const scores = row.map((cell) => candidatesForHeader(String(cell ?? "")));
    const known = scores.filter((items) => items.length > 0).length;
    const uniqueTargets = new Set(scores.filter((items) => items.length > 0).map((items) => items[0].target)).size;
    const looksLikeData = row.filter((cell) => String(cell ?? "").includes("@") || /^https?:/iu.test(String(cell ?? ""))).length;
    const score = known * 10 + uniqueTargets * 2 + Math.min(nonEmpty.length, 10) / 10 - looksLikeData * 2;
    if (!best || score > best.score) best = { index, row, score, known };
  }
  if (!best || best.known === 0) throw new DataValidationError("No recognizable tabular header row found");
  const headers = best.row.map((cell) => String(cell ?? ""));
  const collisions = findHeaderCollisions(headers);
  return {
    headerRowIndex: best.index,
    headers,
    dataRows: rows.slice(best.index + 1),
    collisions,
    knownHeaderCount: best.known,
    issues: collisions.map((collision) => ({ code: ROW_ISSUES.HEADER_COLLISION, severity: "error", ...collision })),
  };
}

/**
 * Return every plausible target. Competing headers are intentionally not
 * resolved here; the caller must confirm the mapping.
 * @param {Array<unknown>} headers
 * @param {{requiredFields?: string[]}} [options]
 */
export function proposeHeaderMapping(headers, options = {}) {
  const proposals = headers.map((value, columnIndex) => {
    const source = String(value ?? "");
    const candidates = candidatesForHeader(source);
    const top = candidates[0];
    return {
      columnIndex,
      source,
      target: top?.target ?? null,
      confidence: Number((top?.score ?? 0).toFixed(3)),
      candidates: candidates.map((candidate) => ({ target: candidate.target, confidence: Number(candidate.score.toFixed(3)) })),
      issue: top ? undefined : ROW_ISSUES.UNMAPPED_HEADER,
    };
  });
  const requiredFields = options.requiredFields ?? [...REQUIRED_FIELDS];
  const mapped = new Set(proposals.map((proposal) => proposal.target).filter(Boolean));
  return proposals.map((proposal) => ({ ...proposal, missingRequiredFields: requiredFields.filter((field) => !mapped.has(field)) }));
}

/** @param {Array<unknown>} headers @param {{requiredFields?: string[]}} [options] */
export function mappingProposal(headers, options = {}) {
  const columns = proposeHeaderMapping(headers, options);
  const byTarget = new Map();
  for (const column of columns) {
    for (const candidate of column.candidates) {
      const list = byTarget.get(candidate.target) ?? [];
      list.push({
        columnIndex: column.columnIndex,
        source: column.source,
        confidence: candidate.confidence,
        isTop: column.target === candidate.target,
      });
      byTarget.set(candidate.target, list);
    }
  }

  const mapping = {};
  const competing = {};

  for (const [target, candidates] of byTarget.entries()) {
    if (candidates.length === 1) {
      mapping[target] = candidates[0].columnIndex;
      continue;
    }

    // Multiple candidates for this target across columns.
    // Identify columns that selected this target as their top (primary) choice.
    const primaries = candidates.filter((c) => c.isTop);

    if (primaries.length === 1) {
      const primary = primaries[0];
      const secondaries = candidates.filter((c) => !c.isTop);
      // If the primary match is unambiguous (every secondary candidate from another column
      // has strictly lower confidence), map to the primary column.
      // A lower-confidence secondary candidate must not invalidate an unambiguous, higher-confidence match.
      const isUnambiguous = secondaries.every((s) => s.confidence < primary.confidence);
      if (isUnambiguous) {
        mapping[target] = primary.columnIndex;
        continue;
      }
    }

    // Multiple primaries or competing candidates with equal/higher confidence:
    // Retain in competing to represent genuine ambiguity.
    const competingList = primaries.length > 1 ? primaries : candidates;
    competing[target] = competingList.map(({ columnIndex, source, confidence }) => ({
      columnIndex,
      source,
      confidence,
    }));
  }

  const requiredFields = options.requiredFields ?? [...REQUIRED_FIELDS];
  return {
    columns,
    mapping,
    competing,
    unmappedHeaders: columns.filter((column) => column.candidates.length === 0).map((column) => column.source),
    missingRequiredFields: requiredFields.filter((field) => !byTarget.has(field)),
  };
}

/** @param {Array<unknown>} headers */
export function headerMap(headers) {
  const proposal = mappingProposal(headers);
  return proposal.mapping;
}

export const mapHeaders = headerMap;
