// @ts-check
import mongoose from "mongoose";
import {
  ProjectSchema,
  ProjectIdSchema,
  deriveEventCode,
  deleteProjectPhotoDir,
  sanitizeSyntheticRoleIssues,
} from "./schemas.js";

const VersionMongoSchema = new mongoose.Schema(
  {
    versionNumber: { type: Number, required: true },
    draftIndex: { type: Number, required: true },
    draft: { type: mongoose.Schema.Types.Mixed, required: true },
    people: { type: [mongoose.Schema.Types.Mixed], default: [] },
    timestamp: { type: String, required: true },
    note: { type: String },
  },
  { _id: false }
);

const ProjectMongoSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    eventCode: { type: String, required: true },
    eventSpec: { type: mongoose.Schema.Types.Mixed, required: true },
    datasetReport: { type: mongoose.Schema.Types.Mixed, default: null },
    people: { type: [mongoose.Schema.Types.Mixed], default: [] },
    currentDrafts: { type: mongoose.Schema.Types.Mixed, default: null },
    draftSeed: { type: mongoose.Schema.Types.Mixed },
    draftIssues: { type: [mongoose.Schema.Types.Mixed], default: [] },
    versions: { type: [VersionMongoSchema], default: [] },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { minimize: false }
);

/**
 * Creates a MongoDB project storage instance using Mongoose.
 * Never logs or prints MONGODB_URI.
 *
 * @param {string} uri
 * @returns {Promise<import("./index.js").StorageInterface>}
 */
export async function createMongoStorage(uri) {
  const connection = await mongoose.createConnection(uri).asPromise();
  const ProjectModel = connection.model("Project", ProjectMongoSchema);

  return {
    type: "mongo",

    async ping() {
      try {
        if (!connection || connection.readyState !== 1 || !connection.db) {
          return false;
        }
        const res = await connection.db.admin().ping();
        return Boolean(res && (res.ok === 1 || res.ok === true));
      } catch {
        return false;
      }
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

      const validated = ProjectSchema.parse(raw);
      await ProjectModel.create(validated);
      return validated;
    },

    async getProject(id) {
      const safeId = ProjectIdSchema.parse(id);
      const doc = await ProjectModel.findOne({ id: safeId }).lean();
      if (!doc) return null;
      return ProjectSchema.parse(doc);
    },

    async listProjects() {
      const docs = await ProjectModel.find({}, "id name eventCode createdAt updatedAt").lean();
      return docs.map((doc) => ({
        id: doc.id,
        name: doc.name,
        eventCode: doc.eventCode,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      }));
    },

    async updateProject(id, updates) {
      const safeId = ProjectIdSchema.parse(id);
      const doc = await ProjectModel.findOne({ id: safeId });
      if (!doc) return null;

      if (updates.name !== undefined) doc.name = updates.name;
      if (updates.eventCode !== undefined) doc.eventCode = updates.eventCode;
      if (updates.eventSpec !== undefined) doc.eventSpec = updates.eventSpec;
      doc.updatedAt = new Date().toISOString();

      await doc.save();
      const updated = await ProjectModel.findOne({ id: safeId }).lean();
      return ProjectSchema.parse(updated);
    },

    async addDatasetReport(id, { report, people }) {
      const safeId = ProjectIdSchema.parse(id);
      const doc = await ProjectModel.findOne({ id: safeId });
      if (!doc) return null;

      doc.datasetReport = report;
      doc.people = people || [];
      doc.updatedAt = new Date().toISOString();

      await doc.save();
      const updated = await ProjectModel.findOne({ id: safeId }).lean();
      return ProjectSchema.parse(updated);
    },

    async addDrafts(id, { drafts, seed, issues }) {
      const safeId = ProjectIdSchema.parse(id);
      const doc = await ProjectModel.findOne({ id: safeId });
      if (!doc) return null;

      const cleanIssues = sanitizeSyntheticRoleIssues(issues || [], doc.people);
      const cleanDrafts = Array.isArray(drafts)
        ? drafts.map((d) => ({
            ...d,
            issues: sanitizeSyntheticRoleIssues(d.issues || [], doc.people),
          }))
        : drafts;

      doc.currentDrafts = cleanDrafts;
      doc.draftSeed = seed;
      doc.draftIssues = cleanIssues;
      doc.updatedAt = new Date().toISOString();

      await doc.save();
      const updated = await ProjectModel.findOne({ id: safeId }).lean();
      return ProjectSchema.parse(updated);
    },

    async saveVersion(id, { draftIndex, note }) {
      const safeId = ProjectIdSchema.parse(id);
      const doc = await ProjectModel.findOne({ id: safeId });
      if (!doc) return null;

      if (!doc.currentDrafts || !doc.currentDrafts[draftIndex]) {
        throw new Error(`Draft index ${draftIndex} not found in project ${id}`);
      }

      const rawDraft = doc.currentDrafts[draftIndex];
      const draft =
        typeof rawDraft.toObject === "function"
          ? rawDraft.toObject()
          : JSON.parse(JSON.stringify(rawDraft));

      if (Array.isArray(draft.issues)) {
        draft.issues = sanitizeSyntheticRoleIssues(draft.issues, doc.people);
      }

      const versionNumber = (doc.versions?.length || 0) + 1;
      const newVersion = {
        versionNumber,
        draftIndex,
        draft,
        people: doc.people || [],
        timestamp: new Date().toISOString(),
        ...(note ? { note } : {}),
      };

      doc.versions.push(newVersion);
      doc.updatedAt = new Date().toISOString();

      await doc.save();
      return newVersion;
    },

    async deleteProject(id) {
      const safeId = ProjectIdSchema.parse(id);
      const res = await ProjectModel.deleteOne({ id: safeId });
      await deleteProjectPhotoDir(safeId);
      return res.deletedCount > 0;
    },

    async close() {
      await connection.close();
    },
  };
}
