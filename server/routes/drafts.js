// @ts-check
import { Router } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { z } from "zod";
import { ProjectIdSchema, getProjectPhotoDir } from "../storage/schemas.js";
import { composeDrafts } from "../../core/composer.js";
import { renderCard } from "../../core/render.js";
import { personNormal } from "../../core/fixtures.js";

const DraftsBodySchema = z
  .object({
    seed: z.union([z.string(), z.number()]).optional(),
    count: z.number().int().min(1).max(10).default(3),
  })
  .optional();

/**
 * Resolves a person's photo to a base64 data URI if present on disk or already a data URI.
 * Guarantees privacy: never returns local filesystem paths to clients.
 *
 * @param {string} projectId
 * @param {any} person
 * @returns {Promise<string | null>}
 */
async function resolvePersonPhotoDataUri(projectId, person) {
  if (!person || !projectId) return null;

  if (typeof person.photo === "string" && person.photo.startsWith("data:")) {
    return person.photo;
  }

  const photoDir = getProjectPhotoDir(projectId);
  const candidates = [];
  if (person.photo) {
    candidates.push(path.basename(person.photo));
  }
  if (person.id) {
    const safeId = String(person.id).replace(/[^A-Za-z0-9._-]/g, "_");
    candidates.push(`${safeId}.jpg`, `${safeId}.jpeg`, `${safeId}.png`, `${safeId}.webp`);
  }

  for (const filename of candidates) {
    const fullPath = path.join(photoDir, filename);
    if (existsSync(fullPath)) {
      try {
        const buf = await fs.readFile(fullPath);
        if (buf && buf.length > 0) {
          const ext = path.extname(filename).toLowerCase().replace(".", "");
          const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
          return `data:${mime};base64,${buf.toString("base64")}`;
        }
      } catch {
        // Fall back gracefully on read error
      }
    }
  }

  return null;
}

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

      // Build sample attendee models for each dynamic role in eventSpec.roles
      const roles = Array.isArray(project.eventSpec?.roles) && project.eventSpec.roles.length > 0
        ? project.eventSpec.roles
        : [{ id: "participant", label: "PARTICIPANT" }];

      const people = Array.isArray(project.people) ? project.people : [];

      /** @type {Record<string, any>} */
      const samplePersonsByRole = {};

      for (const role of roles) {
        const matchingPeople = people.filter((p) => p.roleId === role.id);
        const personWithPhoto = matchingPeople.find((p) => p.photo) || matchingPeople[0];

        let photoDataUri = null;
        if (personWithPhoto) {
          photoDataUri = await resolvePersonPhotoDataUri(project.id, personWithPhoto);
        }

        // Privacy rule (D-10): Never bake real participant personal names or emails into drafts
        // or stored preview scene graphs. Use safe fixture with dynamic roleId and resolved photo.
        samplePersonsByRole[role.id] = {
          id: `PREVIEW-${role.id.toUpperCase().slice(0, 4)}`,
          name: personNormal.name,
          roleId: role.id,
          org: personNormal.org,
          email: personNormal.email,
          photo: photoDataUri || null,
        };
      }

      // Render role-specific preview SVGs for each draft using actual event roles
      for (const draft of result.drafts) {
        draft.roleSvgs = {};
        let primarySvg = null;
        let primaryScene = null;

        for (let i = 0; i < roles.length; i++) {
          const role = roles[i];
          const sample = samplePersonsByRole[role.id];
          const rendered = renderCard({
            skeleton: draft.skeleton,
            blocks: draft.blocks,
            theme: draft.theme,
            look: draft.look,
            event: project.eventSpec,
            eventSpec: project.eventSpec,
            person: sample,
            brand: assets.brandKit,
            fonts: assets.fonts,
            card: project.eventSpec?.card,
          });

          draft.roleSvgs[role.id] = rendered.svg;

          if (i === 0) {
            primarySvg = rendered.svg;
            primaryScene = rendered.scene;
          }
        }

        draft.svg = primarySvg || draft.svg;
        draft.scene = primaryScene || draft.scene;
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
