// @ts-check
import { Router } from "express";
import { z } from "zod";
import { ProjectIdSchema } from "../storage/schemas.js";
import { composeDrafts } from "../../core/composer.js";
import { renderCard } from "../../core/render.js";
import { personNormal } from "../../core/fixtures.js";

const DraftsBodySchema = z
  .object({
    seed: z.union([z.string(), z.number()]).optional(),
    count: z.number().int().min(1).max(10).default(3),
  })
  .optional();

export function createDraftsRouter() {
  const router = Router();

  // POST /projects/:id/drafts - compose drafts and generate preview SVGs
  router.post("/projects/:id/drafts", async (req, res, next) => {
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

      const bodyParse = DraftsBodySchema.safeParse(req.body);
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

      const assets = req.app.locals.assets;
      const count = bodyParse.data?.count ?? 3;
      const seed = bodyParse.data?.seed;

      const result = composeDrafts(project.eventSpec, {
        count,
        seed,
        fonts: assets.fonts,
        brand: assets.brandKit,
        fontRegistry: assets.fontRegistry,
      });

      if (!result.drafts || result.drafts.length === 0) {
        return res.status(422).json({
          error: {
            code: "NO_VALID_DRAFT",
            message: "No valid draft passed the stress set",
            issues: result.issues || [],
          },
        });
      }

      // Ensure every draft has a valid preview SVG
      const samplePerson = project.people?.[0]
        ? { ...project.people[0], photo: null }
        : personNormal;

      for (const draft of result.drafts) {
        if (!draft.svg) {
          const rendered = renderCard({
            eventSpec: project.eventSpec,
            draft,
            person: samplePerson,
            brand: assets.brandKit,
            fonts: assets.fonts,
          });
          draft.svg = rendered.svg;
          draft.scene = rendered.scene;
        }
      }

      // Live OpenType Font instances are not JSON-serializable; remove them before persistence
      // eslint-disable-next-line no-unused-vars
      const serializableDrafts = result.drafts.map(({ fonts, ...rest }) => rest);

      await storage.addDrafts(project.id, {
        drafts: serializableDrafts,
        seed: result.seed,
        issues: result.issues,
      });

      res.json({
        drafts: serializableDrafts,
        seed: result.seed,
        issues: result.issues,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
