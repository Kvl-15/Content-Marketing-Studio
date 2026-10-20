// @ts-check
import { Router } from "express";
import { z } from "zod";
import { EventSpec } from "../../core/schemas.js";
import { ProjectIdSchema, EventCodeSchema, toPublicProject } from "../storage/schemas.js";

const CreateProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(100),
  eventSpec: EventSpec,
  eventCode: EventCodeSchema.optional(),
});

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  eventCode: EventCodeSchema.optional(),
});

const UpdateEventSpecSchema = z.object({
  eventSpec: EventSpec,
});

export function createProjectsRouter() {
  const router = Router();

  // POST /projects - create project
  router.post("/projects", async (req, res, next) => {
    try {
      const parsed = CreateProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        const isEventSpecError = parsed.error.issues.some(
          (i) => i.path[0] === "eventSpec"
        );
        return res.status(400).json({
          error: {
            code: isEventSpecError ? "INVALID_EVENT_SPEC" : "INVALID_REQUEST",
            message: parsed.error.issues
              .map((e) => `${e.path.join(".")}: ${e.message}`)
              .join("; "),
          },
        });
      }

      const storage = req.app.locals.storage;
      const project = await storage.createProject(parsed.data);
      res.status(201).json(toPublicProject(project));
    } catch (err) {
      next(err);
    }
  });

  // GET /projects - list projects
  router.get("/projects", async (req, res, next) => {
    try {
      const storage = req.app.locals.storage;
      const list = await storage.listProjects();
      res.json(list);
    } catch (err) {
      next(err);
    }
  });

  // GET /projects/:id - get project
  router.get("/projects/:id", async (req, res, next) => {
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

      res.json(toPublicProject(project));
    } catch (err) {
      next(err);
    }
  });

  // PUT /projects/:id - update project metadata
  router.put("/projects/:id", async (req, res, next) => {
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

      const bodyParse = UpdateProjectSchema.safeParse(req.body);
      if (!bodyParse.success) {
        return res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: bodyParse.error.issues.map((i) => i.message).join("; "),
          },
        });
      }

      const storage = req.app.locals.storage;
      const updated = await storage.updateProject(idParse.data, bodyParse.data);
      if (!updated) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: `Project '${idParse.data}' not found`,
          },
        });
      }

      res.json(toPublicProject(updated));
    } catch (err) {
      next(err);
    }
  });

  // PUT /projects/:id/event-spec - update and re-validate EventSpec
  router.put("/projects/:id/event-spec", async (req, res, next) => {
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

      const bodyParse = UpdateEventSpecSchema.safeParse(req.body);
      if (!bodyParse.success) {
        return res.status(400).json({
          error: {
            code: "INVALID_EVENT_SPEC",
            message: bodyParse.error.issues.map((i) => i.message).join("; "),
          },
        });
      }

      const storage = req.app.locals.storage;
      const updated = await storage.updateProject(idParse.data, {
        eventSpec: bodyParse.data.eventSpec,
      });

      if (!updated) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: `Project '${idParse.data}' not found`,
          },
        });
      }

      res.json({ status: "ok", eventSpec: updated.eventSpec });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /projects/:id - delete project and photo directory
  router.delete("/projects/:id", async (req, res, next) => {
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
      const deleted = await storage.deleteProject(idParse.data);
      if (!deleted) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: `Project '${idParse.data}' not found`,
          },
        });
      }

      res.json({ status: "ok" });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
