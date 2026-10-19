// @ts-check

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { Person } from "../../core/schemas.js";
import { ROW_ISSUES, ROW_STATUS } from "./constants.js";
import { cleanCellDetails } from "./clean.js";
import { detectHeaderRow, mappingProposal } from "./headers.js";
import { parseInput } from "./detect.js";
import { assignDeterministicIds } from "./ids.js";
import { resolveRole } from "./roles.js";
import { DATA_LIMITS, DEFAULT_LONG_NAME_RULE } from "./limits.js";
import { buildCheckinUrl } from "./qr.js";
import { ingestPhotoZip, matchPhotosToRows, processPhoto, processPhotoZip } from "./photos.js";
import { DataValidationError } from "./errors.js";

const MappingSchema = z.record(z.string(), z.union([z.string(), z.number()]));

/** @param {unknown} value */
function asText(value) { return String(value ?? "").trim(); }

/** @param {Array<Array<unknown>>} rows @param {Array<string>} headers */
function objectRows(rows, headers) {
  return rows.map((row) => {
    const result = {};
    headers.forEach((header, index) => { result[header || `__column_${index}`] = row[index] ?? ""; result[`__column_${index}`] = row[index] ?? ""; });
    return result;
  });
}

/** @param {Array<object>} issues */
function statusFor(issues) {
  return issues.some((issue) => issue.severity === "error") ? ROW_STATUS.ERROR : issues.length ? ROW_STATUS.WARNING : ROW_STATUS.OK;
}

/** @param {string} value */
function safeFilename(value) { return String(value).replace(/[^A-Za-z0-9._-]/gu, "_"); }

/** @param {Array<Record<string, any>>} issues */
function uniqueIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    if (seen.has(issue.code)) return false;
    seen.add(issue.code);
    return true;
  });
}

/** @param {unknown} eventCode @param {any} eventSpec */
function eventCodeFor(eventCode, eventSpec) {
  return asText(eventCode || eventSpec?.eventCode || eventSpec?.code || eventSpec?.event?.code || "EVENT");
}

/**
 * Build cleaned people and a stable row report. `mapping` is target field to
 * source header string or zero-based source column index.
 * @param {string|Uint8Array|ArrayBuffer|Buffer} input
 * @param {{eventSpec:any,mapping?:Record<string,string|number>,photos?:any,outputDir?:string,eventCode?:string,excludeErrors?:boolean,roleValue?:string,longNameThreshold?:number,photoOptions?:Record<string,any>}} options
 */
export async function buildDataset(input, options) {
  if (!options?.eventSpec) throw new DataValidationError("eventSpec is required");
  const parsed = parseInput(input);
  if (parsed.rows.length > DATA_LIMITS.maxRows + 1) throw new DataValidationError("Input has too many rows", { maxRows: DATA_LIMITS.maxRows });
  const header = detectHeaderRow(parsed.rows);
  const proposed = mappingProposal(header.headers);
  const mapping = options.mapping ? MappingSchema.parse(options.mapping) : null;
  if (!mapping) throw new DataValidationError("A confirmed mapping is required", { proposal: proposed });
  const rawRows = objectRows(header.dataRows.slice(0, DATA_LIMITS.maxRows), header.headers);
  const rowReports = [];
  const normalizedRows = [];
  let formulaLikeCells = 0;
  rawRows.forEach((sourceRow, index) => {
    const rowNumber = header.headerRowIndex + index + 2;
    const values = {};
    const rawFields = ["id", "name", "roleId", "org", "email", "photo"];
    let controlRemoved = false;
    formulaLikeCells += Object.values(sourceRow).filter((value) => /^\s*[=+\-@]/u.test(String(value ?? ""))).length;
    for (const field of rawFields) {
      const source = mapping[field] ?? mapping[field === "roleId" ? "role" : field];
      const raw = source === undefined ? "" : typeof source === "number" ? sourceRow[`__column_${source}`] : sourceRow[source];
      const detail = cleanCellDetails(raw);
      values[field] = detail.value;
      controlRemoved ||= detail.removedControlCharacters || detail.removedZeroWidthCharacters;
    }
    if (!mapping.roleId && !mapping.role && options.roleValue !== undefined) values.roleId = asText(options.roleValue);
    const issues = [];
    if (controlRemoved) issues.push({ code: ROW_ISSUES.CONTROL_CHARACTERS_REMOVED, severity: "warning", rowNumber });
    if (Object.values(values).every((value) => !value)) { issues.push({ code: ROW_ISSUES.EMPTY_ROW, severity: "warning", rowNumber }); }
    if (!values.name) issues.push({ code: ROW_ISSUES.MISSING_NAME, severity: "error", rowNumber, message: "Name is required" });
    const role = resolveRole(values.roleId, options.eventSpec, { rowNumber });
    if (role.issue) issues.push(role.issue);
    else values.roleId = role.roleId;
    if (!mapping.org || !values.org) issues.push({ code: ROW_ISSUES.MISSING_OPTIONAL_FIELD, severity: "warning", rowNumber, field: "org" });
    if (!mapping.email || !values.email) issues.push({ code: ROW_ISSUES.MISSING_OPTIONAL_FIELD, severity: "warning", rowNumber, field: "email" });
    if (!values.photo) issues.push({ code: ROW_ISSUES.NO_PHOTO, severity: "warning", rowNumber, message: "No photo was supplied" });
    // LONG_NAME is only a hint; preflight decides whether the real name fits.
    if (values.name.length > (options.longNameThreshold ?? DEFAULT_LONG_NAME_RULE.fallbackMaxCharacters)) issues.push({ code: ROW_ISSUES.LONG_NAME, severity: "warning", rowNumber, length: values.name.length });
    normalizedRows.push({ ...values, __rowNumber: rowNumber, __issues: issues });
  });

  const assigned = assignDeterministicIds(normalizedRows, { eventCode: eventCodeFor(options.eventCode, options.eventSpec), roleField: "roleId" });
  for (const issue of assigned.issues) {
    const target = assigned.rows.find((row) => row.__sourceRowNumber === issue.rowNumber);
    if (target) target.__issues.push(issue);
  }

  let photoSet = { photos: [], warnings: [], matches: [], unmatchedRows: [], unmatchedFiles: [] };
  if (options.photos) {
    const photoInput = Buffer.isBuffer(options.photos) || options.photos instanceof Uint8Array ? options.photos : options.photos.zip;
    const archiveInput = photoInput ?? options.photos;
    if (options.outputDir && !Array.isArray(options.photos)) {
      photoSet = await processPhotoZip(archiveInput, assigned.rows, {
        outputDir: options.outputDir,
        limits: options.photoOptions,
        processOptions: options.photoOptions,
        writePhoto: async (row, processed) => {
          await mkdir(options.outputDir, { recursive: true });
          const filename = `${safeFilename(row.id)}.jpg`;
          const outputPath = join(options.outputDir, filename);
          await writeFile(outputPath, processed.buffer);
          return outputPath;
        },
      });
    } else if (archiveInput) photoSet = { ...(await ingestPhotoZip(archiveInput, options.photoOptions)), matches: [], unmatchedRows: [], unmatchedFiles: [] };
    else if (Array.isArray(options.photos)) photoSet.photos = options.photos;
  }
  const match = photoSet.matches?.length || photoSet.unmatchedRows?.length || photoSet.unmatchedFiles?.length
    ? photoSet
    : options.photos
    ? matchPhotosToRows(assigned.rows, photoSet.photos)
    : { matches: [], unmatchedRows: [], unmatchedFiles: [], warnings: [] };
  photoSet = { ...photoSet, ...match };
  const photoByRow = new Map(match.matches.map((item) => [item.rowIndex, item.photo]));
  const people = [];
  const excludeErrors = options.excludeErrors !== false;
  for (let index = 0; index < assigned.rows.length; index += 1) {
    const row = assigned.rows[index];
    let issues = [...(row.__issues ?? [])];
    const photo = photoByRow.get(index);
    let photoPath = null;
    const streamedMatch = photoSet.matches?.find((match) => match.rowIndex === index);
    if (streamedMatch) {
      issues = issues.filter((issue) => issue.code !== ROW_ISSUES.NO_PHOTO);
      photoPath = streamedMatch.outputPath;
      if (streamedMatch.effectiveDpi < (options.photoOptions?.lowPhotoDpi ?? DATA_LIMITS.lowPhotoDpi)) issues.push({ code: ROW_ISSUES.LOW_PHOTO_DPI, severity: "warning", rowNumber: row.__rowNumber, effectiveDpi: streamedMatch.effectiveDpi });
    } else if (photo && options.outputDir) {
      try {
        const processed = await processPhoto(photo.buffer, { ...options.photoOptions, slot: options.photoOptions?.slot ?? { widthMm: 54, heightMm: 85.6 } });
        await mkdir(options.outputDir, { recursive: true });
        const filename = `${safeFilename(row.id)}.jpg`;
        await writeFile(join(options.outputDir, filename), processed.buffer);
        photoPath = join(options.outputDir, filename);
        if (processed.effectiveDpi < (options.photoOptions?.lowPhotoDpi ?? DATA_LIMITS.lowPhotoDpi)) issues.push({ code: ROW_ISSUES.LOW_PHOTO_DPI, severity: "warning", rowNumber: row.__rowNumber, effectiveDpi: processed.effectiveDpi });
      } catch (error) {
        issues.push({ code: ROW_ISSUES.CORRUPT_PHOTO, severity: "warning", rowNumber: row.__rowNumber, message: error instanceof Error ? error.message : "Photo could not be processed" });
      }
    } else if (!photo && options.photos) {
      issues.push({ code: ROW_ISSUES.NO_PHOTO, severity: "warning", rowNumber: row.__rowNumber });
    }
    issues = uniqueIssues(issues);
    const flags = issues.filter((issue) => issue.code === ROW_ISSUES.LONG_NAME || issue.code === ROW_ISSUES.NO_PHOTO || issue.code === ROW_ISSUES.DUPLICATE_ID).map((issue) => issue.code);
    const personCandidate = { id: row.id, name: row.name, roleId: row.roleId, ...(row.org ? { org: row.org } : {}), ...(row.email ? { email: row.email } : {}), photo: photoPath, flags };
    if (options.eventSpec?.qr?.enabled && options.eventSpec.qr.urlPattern && !issues.some((issue) => issue.severity === "error")) {
      try { personCandidate.checkinUrl = buildCheckinUrl(row.id, options.eventSpec.qr.urlPattern); }
      catch (error) { issues.push({ code: "INVALID_QR_PATTERN", severity: "error", rowNumber: row.__rowNumber, message: error instanceof Error ? error.message : "Invalid QR pattern" }); }
    }
    const parsedPerson = Person.safeParse(personCandidate);
    if (!parsedPerson.success && !issues.some((issue) => issue.severity === "error")) issues.push({ code: ROW_ISSUES.INVALID_ROW, severity: "error", rowNumber: row.__rowNumber, message: parsedPerson.error.message });
    issues = uniqueIssues(issues);
    const status = statusFor(issues);
    rowReports.push({ rowNumber: row.__rowNumber, id: row.id, status, issues: issues.map((issue) => ({ ...issue })) });
    if (parsedPerson.success && (!excludeErrors || status !== ROW_STATUS.ERROR)) people.push(parsedPerson.data);
  }

  for (const warning of photoSet.warnings) rowReports.push({ rowNumber: null, status: "WARNING", issues: [{ ...warning }] });
  const totals = { rows: rowReports.filter((row) => row.rowNumber !== null).length, ok: rowReports.filter((row) => row.status === ROW_STATUS.OK).length, warnings: rowReports.filter((row) => row.status === ROW_STATUS.WARNING).length, errors: rowReports.filter((row) => row.status === ROW_STATUS.ERROR).length };
  const report = {
    format: parsed.format,
    firstSheet: parsed.format === "xlsx" ? parsed.sheetName : undefined,
    delimiter: parsed.delimiter,
    headerRow: header.headerRowIndex + 1,
    headers: header.headers,
    mapping: proposed,
    rows: rowReports,
    totals,
    formulaLikeCells,
    matchedPhotos: (match.matches ?? []).map((item) => ({
      rowNumber: assigned.rows[item.rowIndex]?.__rowNumber ?? null,
      id: assigned.rows[item.rowIndex]?.id ?? null,
      file: item.file ?? item.photo?.path ?? item.photo?.filename ?? null,
      method: item.method ?? "unknown",
    })),
    unmatchedPhotoFiles: match.unmatchedFiles.map((photo) => typeof photo === "string" ? photo : photo.path || photo.filename).sort(),
    unmatchedRows: match.unmatchedRows.map((item) => item.rowIndex + header.headerRowIndex + 2),
    longNameMeasurement: { appliedCharacterThreshold: options.longNameThreshold ?? DEFAULT_LONG_NAME_RULE.fallbackMaxCharacters, note: "LONG_NAME is only a hint. Preflight decides whether the real name fits the selected design." },
    limits: DATA_LIMITS,
  };
  return { people, report };
}
