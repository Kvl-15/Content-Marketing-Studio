// @ts-check
import {
  ProjectSchema,
  ProjectIdSchema,
  deriveEventCode,
  deleteProjectPhotoDir,
  sanitizeSyntheticRoleIssues,
} from "./schemas.js";

/**
 * Creates an in-memory project storage instance.
 *
 * @returns {import("./index.js").StorageInterface}
 */
export function createMemoryStorage() {
  /** @type {Map<string, any>} */
  const projects = new Map();

  return {
    type: "memory",

    async ping() {
      return true;
    },

    async createProject({ name, eventSpec, eventCode }) {
      const now = new Date().toISOString();
      const randomPart = Math.random().toString(36).slice(2, 10);
      const id = `proj_${Date.now()}_${randomPart}`;

      const finalEventCode =
        eventCode ||
        deriveEventCode(name, eventSpec?.event?.dates?.value);

      const raw = {
        id,
        name,
        eventCode: finalEventCode,
        eventSpec,
        datasetReport: null,
        people: [],
        currentDrafts: null,
        draftSeed: undefined,
        draftIssues: [],
        versions: [],
        createdAt: now,
        updatedAt: now,
      };

      const project = ProjectSchema.parse(raw);
      projects.set(id, structuredClone(project));
      return structuredClone(project);
    },

    async getProject(id) {
      const safeId = ProjectIdSchema.parse(id);
      const existing = projects.get(safeId);
      if (!existing) return null;
      return structuredClone(ProjectSchema.parse(existing));
    },

    async listProjects() {
      return Array.from(projects.values()).map((p) => ({
        id: p.id,
        name: p.name,
        eventCode: p.eventCode,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));
    },

    async updateProject(id, updates) {
      const safeId = ProjectIdSchema.parse(id);
      const existing = projects.get(safeId);
      if (!existing) return null;

      const updated = {
        ...existing,
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.eventCode !== undefined ? { eventCode: updates.eventCode } : {}),
        ...(updates.eventSpec !== undefined ? { eventSpec: updates.eventSpec } : {}),
        updatedAt: new Date().toISOString(),
      };

      const validated = ProjectSchema.parse(updated);
      projects.set(safeId, structuredClone(validated));
      return structuredClone(validated);
    },

    async addDatasetReport(id, { report, people }) {
      const safeId = ProjectIdSchema.parse(id);
      const existing = projects.get(safeId);
      if (!existing) return null;

      const updated = {
        ...existing,
        datasetReport: report,
        people: people || [],
        updatedAt: new Date().toISOString(),
      };

      const validated = ProjectSchema.parse(updated);
      projects.set(safeId, structuredClone(validated));
      return structuredClone(validated);
    },

    async addDrafts(id, { drafts, seed, issues }) {
      const safeId = ProjectIdSchema.parse(id);
      const existing = projects.get(safeId);
      if (!existing) return null;

      const cleanIssues = sanitizeSyntheticRoleIssues(issues || [], existing.people);
      const cleanDrafts = Array.isArray(drafts)
        ? drafts.map((d) => ({
            ...d,
            issues: sanitizeSyntheticRoleIssues(d.issues || [], existing.people),
          }))
        : drafts;

      const updated = {
        ...existing,
        currentDrafts: cleanDrafts,
        draftSeed: seed,
        draftIssues: cleanIssues,
        updatedAt: new Date().toISOString(),
      };

      const validated = ProjectSchema.parse(updated);
      projects.set(safeId, structuredClone(validated));
      return structuredClone(validated);
    },

    async saveVersion(id, { draftIndex, note }) {
      const safeId = ProjectIdSchema.parse(id);
      const existing = projects.get(safeId);
      if (!existing) return null;

      if (!existing.currentDrafts || !existing.currentDrafts[draftIndex]) {
        throw new Error(`Draft index ${draftIndex} not found in project ${id}`);
      }

      const draft = structuredClone(existing.currentDrafts[draftIndex]);
      if (Array.isArray(draft.issues)) {
        draft.issues = sanitizeSyntheticRoleIssues(draft.issues, existing.people);
      }

      const versionNumber = (existing.versions?.length || 0) + 1;
      const newVersion = {
        versionNumber,
        draftIndex,
        draft,
        people: structuredClone(existing.people || []),
        timestamp: new Date().toISOString(),
        ...(note ? { note } : {}),
      };

      const versions = [...(existing.versions || []), newVersion];
      const updated = {
        ...existing,
        versions,
        updatedAt: new Date().toISOString(),
      };

      const validated = ProjectSchema.parse(updated);
      projects.set(safeId, structuredClone(validated));
      return structuredClone(newVersion);
    },

    async deleteProject(id) {
      const safeId = ProjectIdSchema.parse(id);
      const existed = projects.delete(safeId);
      await deleteProjectPhotoDir(safeId);
      return existed;
    },

    async close() {
      // No-op for in-memory storage
    },
  };
}
