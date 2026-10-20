// @ts-check
import { Router } from "express";
import { createHealthRouter } from "./health.js";
import { createProjectsRouter } from "./projects.js";
import { createDataRouter } from "./data.js";
import { createPhotosRouter } from "./photos.js";
import { createDraftsRouter } from "./drafts.js";
import { createVersionsRouter } from "./versions.js";
import { createExportRouter } from "./export.js";

/**
 * Mounts all server routes.
 *
 * @returns {Router}
 */
export function createApiRouter() {
  const router = Router();

  router.use(createHealthRouter());
  router.use(createProjectsRouter());
  router.use(createDataRouter());
  router.use(createPhotosRouter());
  router.use(createDraftsRouter());
  router.use(createVersionsRouter());
  router.use(createExportRouter());

  return router;
}
