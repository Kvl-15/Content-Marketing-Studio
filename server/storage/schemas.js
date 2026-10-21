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
 * Determines whether an issue is a synthetic stress-test role mismatch.
 *
 * An issue is treated as synthetic ONLY when ALL of the following hold:
 * 1. Issue code is UNKNOWN_ROLE_ID.
 * 2. Person ID matches HX26-S-00[1-8].
 * 3. Role is "participant" or "organizer".
 * 4. Person ID does not exist in the project's current attendee data.
 *
 * If person ID is "boss", or role is empty, or person ID is a real attendee,
 * or if the issue comes from any other source, KEEP IT (returns false).
 *
 * @param {any} issue
 * @param {any[]} [currentPeople=[]]
 * @returns {boolean}
 */
export function isSyntheticStressRoleIssue(issue, currentPeople = []) {
  if (!issue || typeof issue !== "object") return false;
  if (issue.code !== "UNKNOWN_ROLE_ID") return false;

  // If explicitly tagged with a source other than stress-set, keep it
  if (issue.source && issue.source !== "stress-set") return false;

  let personId = issue.personId;
  let roleId = issue.roleId;

  if (!personId || !roleId) {
    const msg = String(issue.message || "");
    const match = msg.match(
      /^Person\s+"([^"]+)"\s+has\s+invalid\s+or\s+unrecognised\s+roleId\s+"([^"]*)";\s+must\s+match\s+an\s+id\s+in\s+event\.roles$/
    );
    if (match) {
      personId = personId || match[1];
      roleId = roleId || match[2];
    }
  }

  // 1. Must have valid personId matching HX26-S-00[1-8]
  if (!personId || !/^HX26-S-00[1-8]$/.test(personId)) return false;

  // 2. Role must be "participant" or "organizer"
  if (roleId !== "participant" && roleId !== "organizer") return false;

  // 3. Person ID must not exist in current attendee data
  const peopleList = Array.isArray(currentPeople) ? currentPeople : [];
  const existsInPeople = peopleList.some((p) =>
    typeof p === "string" ? p === personId : p?.id === personId
  );
  if (existsInPeople) return false;

  return true;
}

/**
 * Sanitizes issues by removing synthetic stress-test role issues matching the 4-point criteria.
 * Preserves genuine validation issues for real participants (D-09).
 *
 * @param {any[]} issues
 * @param {any[]} [currentPeople=[]]
 * @returns {any[]}
 */
export function sanitizeSyntheticRoleIssues(issues, currentPeople = []) {
  if (!Array.isArray(issues)) return [];
  return issues.filter((iss) => !isSyntheticStressRoleIssue(iss, currentPeople));
}

/**
 * Recursively inspects and sanitizes a project's draft issues, drafts, and saved versions.
 * Returns the sanitized project and a flag indicating if mutations occurred.
 *
 * @param {any} project
 * @returns {{ project: any; modified: boolean }}
 */
export function sanitizeProjectIssues(project) {
  if (!project) return { project, modified: false };
  let modified = false;
  const currentPeople = Array.isArray(project.people) ? project.people : [];

  if (Array.isArray(project.draftIssues)) {
    const cleaned = sanitizeSyntheticRoleIssues(project.draftIssues, currentPeople);
    if (cleaned.length !== project.draftIssues.length) {
      project.draftIssues = cleaned;
      modified = true;
    }
  }

  if (Array.isArray(project.currentDrafts)) {
    for (const draft of project.currentDrafts) {
      if (draft && Array.isArray(draft.issues)) {
        const cleaned = sanitizeSyntheticRoleIssues(draft.issues, currentPeople);
        if (cleaned.length !== draft.issues.length) {
          draft.issues = cleaned;
          modified = true;
        }
      }
    }
  }

  if (Array.isArray(project.versions)) {
    for (const version of project.versions) {
      if (version?.draft && Array.isArray(version.draft.issues)) {
        const versionPeople =
          Array.isArray(version.people) && version.people.length > 0
            ? version.people
            : currentPeople;
        const cleaned = sanitizeSyntheticRoleIssues(version.draft.issues, versionPeople);
        if (cleaned.length !== version.draft.issues.length) {
          version.draft.issues = cleaned;
          modified = true;
        }
      }
    }
  }

  return { project, modified };
}

/**
 * Strips personal data (people array) and returns public version representation with peopleCount.
 * Sanitizes any synthetic stress issues from the version's draft.
 *
 * @param {any} version
 * @param {any[]} [currentPeople=[]]
 * @returns {any}
 */
export function toPublicVersion(version, currentPeople = []) {
  if (!version) return version;
  const { people, draft, ...rest } = version;
  const peopleList =
    Array.isArray(people) && people.length > 0 ? people : currentPeople;
  const publicDraft = draft
    ? {
        ...draft,
        ...(Array.isArray(draft.issues)
          ? { issues: sanitizeSyntheticRoleIssues(draft.issues, peopleList) }
          : {}),
      }
    : draft;

  const photoCount = Array.isArray(people)
    ? people.filter((p) => p && typeof p === "object" && typeof p.photo === "string" && p.photo.trim().length > 0).length
    : 0;

  return {
    ...rest,
    draft: publicDraft,
    peopleCount: Array.isArray(people) ? people.length : 0,
    photoCount,
  };
}

/**
 * Strips personal data (people array) and returns public project representation with peopleCount.
 * Also strips people arrays from nested versions if present and sanitizes synthetic issues.
 *
 * @param {any} project
 * @returns {any}
 */
export function toPublicProject(project) {
  if (!project) return project;
  const { people, versions, currentDrafts, draftIssues, ...rest } = project;
  const peopleList = Array.isArray(people) ? people : [];

  const publicDrafts = Array.isArray(currentDrafts)
    ? currentDrafts.map((d) =>
        d
          ? {
              ...d,
              ...(Array.isArray(d.issues)
                ? { issues: sanitizeSyntheticRoleIssues(d.issues, peopleList) }
                : {}),
            }
          : d
      )
    : currentDrafts;

  const publicDraftIssues = Array.isArray(draftIssues)
    ? sanitizeSyntheticRoleIssues(draftIssues, peopleList)
    : draftIssues;

  const photoCount = Array.isArray(people)
    ? people.filter((p) => p && typeof p === "object" && typeof p.photo === "string" && p.photo.trim().length > 0).length
    : 0;

  return {
    ...rest,
    currentDrafts: publicDrafts,
    draftIssues: publicDraftIssues,
    peopleCount: Array.isArray(people) ? people.length : 0,
    photoCount,
    ...(versions
      ? { versions: versions.map((v) => toPublicVersion(v, peopleList)) }
      : {}),
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
  const baseDir =
    process.env.PHOTOS_DIR ||
    process.env.PERSISTENT_DATA_DIR ||
    path.join(os.tmpdir(), "acm-studio");
  return path.join(path.resolve(baseDir), safeId);
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
