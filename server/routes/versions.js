// @ts-check
import { Router } from "express";
import { z } from "zod";
import { ProjectIdSchema, toPublicVersion } from "../storage/schemas.js";

const CreateVersionSchema = z.object({
  draftIndex: z.number().int().min(0).max(2),
  note: z.string().max(500).optional(),
});

export function createVersionsRouter() {
  const router = Router();

  // POST /projects/:id/versions - snapshot chosen draft & dataset as immutable version
  router.post("/projects/:id/versions", async (req, res, next) => {
    try {
      const idParse = ProjectIdSchema.safeParse(req.params.id);
      if (!idParse.success) {
        return res.status(400).json({
          error: {
            code: "INVALID_PROJECT_ID",
            message: idParse.error.issues.map((i) => i.message).join("; "),
          },
        });
      }

      const bodyParse = CreateVersionSchema.safeParse(req.body);
      if (!bodyParse.success) {
        return res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: bodyParse.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          },
        });
      }

      const storage = req.app.locals.storage;
      const project = await storage.getProject(idParse.data);
      if (!project) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: `Project '${idParse.data}' not found`,
          },
        });
      }

      const { draftIndex, note } = bodyParse.data;

      if (!project.currentDrafts || !project.currentDrafts[draftIndex]) {
        return res.status(400).json({
          error: {
            code: "NO_DRAFTS",
            message: `Draft index ${draftIndex} not found; compose drafts first`,
          },
        });
      }

      if (!project.people || project.people.length === 0) {
        return res.status(400).json({
          error: {
            code: "NO_DATASET",
            message: "No dataset uploaded yet; upload participant data before creating a version",
          },
        });
      }

      const version = await storage.saveVersion(project.id, {
        draftIndex,
        note,
      });

      res.status(201).json(toPublicVersion(version));
    } catch (err) {
      next(err);
    }
  });

  // GET /projects/:id/versions - list saved versions
  router.get("/projects/:id/versions", async (req, res, next) => {
    try {
      const idParse = ProjectIdSchema.safeParse(req.params.id);
      if (!idParse.success) {
        return res.status(400).json({
          error: {
            code: "INVALID_PROJECT_ID",
            message: idParse.error.issues.map((i) => i.message).join("; "),
          },
        });
      }

      const storage = req.app.locals.storage;
      const project = await storage.getProject(idParse.data);
      if (!project) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: `Project '${idParse.data}' not found`,
          },
        });
      }

      res.json((project.versions || []).map(toPublicVersion));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
