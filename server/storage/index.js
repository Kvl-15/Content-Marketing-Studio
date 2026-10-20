// @ts-check
import { createMemoryStorage } from "./memory.js";
import { createMongoStorage } from "./mongo.js";

export * from "./schemas.js";
export { createMemoryStorage } from "./memory.js";
export { createMongoStorage } from "./mongo.js";

/**
 * @typedef {{
 *   type: "memory" | "mongo";
 *   createProject: (input: { name: string; eventSpec: any; eventCode?: string }) => Promise<any>;
 *   getProject: (id: string) => Promise<any | null>;
 *   listProjects: () => Promise<Array<{ id: string; name: string; eventCode: string; createdAt: string; updatedAt: string }>>;
 *   updateProject: (id: string, updates: { name?: string; eventCode?: string; eventSpec?: any }) => Promise<any | null>;
 *   addDatasetReport: (id: string, data: { report: any; people: any[] }) => Promise<any | null>;
 *   addDrafts: (id: string, data: { drafts: any[]; seed?: any; issues?: any[] }) => Promise<any | null>;
 *   saveVersion: (id: string, data: { draftIndex: number; note?: string }) => Promise<any>;
 *   deleteProject: (id: string) => Promise<boolean>;
 *   ping?: () => Promise<boolean>;
 *   close: () => Promise<void>;
 * }} StorageInterface
 */

/**
 * Initializes the storage backend.
 * Selection:
 *   STORAGE=mongo|memory (default memory when MONGODB_URI is missing).
 *
 * @param {{ storage?: string; mongoUri?: string }} [config]
 * @returns {Promise<StorageInterface>}
 */
export async function initStorage(config = {}) {
  const requested = (config.storage || process.env.STORAGE || "memory").toLowerCase();
  const uri = config.mongoUri || process.env.MONGODB_URI;

  if (requested === "mongo") {
    if (!uri) {
      console.log(
        "[storage] STORAGE=mongo requested but MONGODB_URI is missing; defaulting to in-memory storage."
      );
      return createMemoryStorage();
    }
    try {
      const storage = await createMongoStorage(uri);
      console.log("[storage] Using MongoDB storage backend.");
      return storage;
    } catch (err) {
      console.error(
        "[storage] Failed to connect to MongoDB; falling back to in-memory storage:",
        err?.message || err
      );
      return createMemoryStorage();
    }
  }

  console.log("[storage] Using in-memory storage backend.");
  return createMemoryStorage();
}
