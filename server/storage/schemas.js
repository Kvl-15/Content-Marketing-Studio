// @ts-check
import { z } from "zod";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { EventSpec } from "../../core/schemas.js";

/** Safe project identifier schema: 1-64 alphanumeric, underscores, hyphens */
export const ProjectIdSchema = z
  .string()
  .min(1, "Project ID cannot be empty")
  .max(64, "Project ID too long")
  .regex(/^[a-zA-Z0-9_-]+$/, "Project ID must contain only letters, numbers, underscores, and hyphens");

/** Event code: 2-8 uppercase letters or digits */
export const EventCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{2,8}$/, "Event code must be 2 to 8 uppercase alphanumeric characters");

/** Cleaned person schema as stored in database */
export const StoredPersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  roleId: z.string(),
  org: z.string().optional(),
  email: z.string().optional(),
  photo: z.string().nullable().optional(),
  checkinUrl: z.string().optional(),
  flags: z.array(z.string()).default([]),
}).passthrough();

/** Saved version schema */
export const VersionSchema = z.object({
  versionNumber: z.number().int().positive(),
  draftIndex: z.number().int().min(0).max(2),
  draft: z.any(),
  people: z.array(StoredPersonSchema).default([]),
  timestamp: z.string(),
  note: z.string().optional(),
});

/** Full project schema validated at database and storage boundaries */
export const ProjectSchema = z.object({
  id: ProjectIdSchema,
  name: z.string().min(1).max(100),
  eventCode: EventCodeSchema,
  eventSpec: EventSpec,
  datasetReport: z.any().nullable().default(null),
  people: z.array(StoredPersonSchema).default([]),
  currentDrafts: z.array(z.any()).nullable().default(null),
  draftSeed: z.union([z.string(), z.number()]).optional(),
  draftIssues: z.array(z.any()).default([]),
  versions: z.array(VersionSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Strips personal data (people array) and returns public version representation with peopleCount.
 *
 * @param {any} version
 * @returns {any}
 */
export function toPublicVersion(version) {
  if (!version) return version;
  const { people, ...rest } = version;
  return {
    ...rest,
    peopleCount: Array.isArray(people) ? people.length : 0,
  };
}

/**
 * Strips personal data (people array) and returns public project representation with peopleCount.
 * Also strips people arrays from nested versions if present.
 *
 * @param {any} project
 * @returns {any}
 */
export function toPublicProject(project) {
  if (!project) return project;
  const { people, versions, ...rest } = project;
  return {
    ...rest,
    peopleCount: Array.isArray(people) ? people.length : 0,
    ...(versions ? { versions: versions.map(toPublicVersion) } : {}),
  };
}

/**
 * Derives a 2 to 8 uppercase alphanumeric event code from event name and dates.
 *
 * @param {string} eventName
 * @param {string[] | unknown} [dates]
 * @returns {string}
 */
export function deriveEventCode(eventName, dates) {
  let year = "26";
  if (Array.isArray(dates) && dates.length > 0 && typeof dates[0] === "string") {
    const match = dates[0].match(/\b(20\d{2})\b/);
    if (match) year = match[1].slice(-2);
  } else if (typeof eventName === "string") {
    const match = eventName.match(/\b(20\d{2})\b/);
    if (match) year = match[1].slice(-2);
  }

  const words = String(eventName || "")
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let base = "";
  if (words.length === 1) {
    base = words[0].slice(0, 4).toUpperCase();
  } else if (words.length > 1) {
    base = words.map((w) => w[0]).join("").toUpperCase().slice(0, 6);
  }
  if (!base) base = "EV";

  let code = (base + year).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length < 2) code = "EV26";
  if (code.length > 8) code = code.slice(0, 8);
  return code;
}

/**
 * Path to project photo directory in OS temp folder.
 * Ensures path stays strictly inside os.tmpdir()/acm-studio/<projectId>.
 *
 * @param {string} projectId
 * @returns {string}
 */
export function getProjectPhotoDir(projectId) {
  const safeId = ProjectIdSchema.parse(projectId);
  return path.join(os.tmpdir(), "acm-studio", safeId);
}

/**
 * Ensures project photo directory exists.
 *
 * @param {string} projectId
 * @returns {Promise<string>}
 */
export async function ensureProjectPhotoDir(projectId) {
  const dir = getProjectPhotoDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Deletes project photo directory on disk.
 *
 * @param {string} projectId
 * @returns {Promise<void>}
 */
export async function deleteProjectPhotoDir(projectId) {
  const dir = getProjectPhotoDir(projectId);
  if (existsSync(dir)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
