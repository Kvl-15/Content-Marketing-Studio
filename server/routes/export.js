// @ts-check
import { Router } from "express";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { ProjectIdSchema, getProjectPhotoDir } from "../storage/schemas.js";
import {
  exportCard,
  exportSheet,
  exportZip,
  closeSharedBrowser,
} from "../export/index.js";

/** Tracks currently executing export tasks per project to enforce one-at-a-time */
export const activeProjectExports = new Set();

const ExportBodySchema = z.object({
  version: z.number().int().positive().optional(),
  kind: z.enum(["card", "sheet", "zip"]).default("sheet"),
  format: z.enum(["svg", "png", "pdf"]).optional(),
  personId: z.string().optional(),
  printerSafeMm: z.number().min(0).max(20).optional(),
  paper: z.enum(["A4", "A3", "custom"]).optional(),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
  sides: z.enum(["front", "back", "both"]).default("front"),
  acknowledgedWarnings: z.boolean().default(false),
  dpi: z.number().int().min(72).max(1200).optional(),
});

/**
 * Creates a streaming photoSource provider that reads disk photos on demand.
 * Photos are stored under os.tmpdir()/acm-studio/<projectId>/.
 *
 * @param {string} projectId
 * @param {any[]} people
 * @returns {(personId: string) => Promise<Buffer | null>}
 */
function createDiskPhotoSource(projectId, people) {
  const photoDir = getProjectPhotoDir(projectId);
  const peopleMap = new Map((people || []).map((p) => [p.id, p]));

  return async function photoSource(personId) {
    const person = peopleMap.get(personId);
    if (!person) return null;

    const candidates = [];
    if (person.photo) {
      candidates.push(path.basename(person.photo));
    }
    const safeId = String(person.id).replace(/[^A-Za-z0-9._-]/g, "_");
    candidates.push(
      `${safeId}.jpg`,
      `${safeId}.jpeg`,
      `${safeId}.png`,
      `${safeId}.webp`
    );

    for (const filename of candidates) {
      const fullPath = path.join(photoDir, filename);
      if (existsSync(fullPath)) {
        return fs.readFile(fullPath);
      }
    }
    return null;
  };
}

export function createExportRouter() {
  const router = Router();

  // POST /projects/:id/export - export card, sheet, or batch ZIP
  router.post("/projects/:id/export", async (req, res, next) => {
    const idParse = ProjectIdSchema.safeParse(req.params.id);
    if (!idParse.success) {
      return res.status(400).json({
        error: {
          code: "INVALID_PROJECT_ID",
          message: idParse.error.issues.map((i) => i.message).join("; "),
        },
      });
    }

    const projectId = idParse.data;

    // Concurrency guard: only one export per project at a time (Condition 4)
    if (activeProjectExports.has(projectId)) {
      return res.status(409).json({
        error: {
          code: "EXPORT_IN_PROGRESS",
          message: `An export is already running for project '${projectId}'. Only one export per project is permitted at a time.`,
        },
      });
    }

    activeProjectExports.add(projectId);

    // Ensure browser is closed even when client disconnects early (Condition 4)
    req.on("close", async () => {
      if (!res.writableEnded) {
        try {
          await closeSharedBrowser();
        } catch {
          // ignore error on abort cleanup
        }
      }
    });

    try {
      const bodyParse = ExportBodySchema.safeParse(req.body);
      if (!bodyParse.success) {
        return res.status(400).json({
          error: {
            code: "INVALID_EXPORT_SETTINGS",
            message: bodyParse.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          },
        });
      }

      const body = bodyParse.data;

      // Condition 2: Refuse landscape and sides back/both with 422
      if (body.orientation === "landscape") {
        return res.status(422).json({
          error: {
            code: "UNSUPPORTED_ORIENTATION",
            message: "Landscape cards are not supported yet",
          },
        });
      }

      if (body.sides === "back" || body.sides === "both") {
        return res.status(422).json({
          error: {
            code: "UNSUPPORTED_SIDES",
            message: `Sides '${body.sides}' is not supported: card back generation is deferred to Stage B. Fronts only.`,
          },
        });
      }

      const storage = req.app.locals.storage;
      const project = await storage.getProject(projectId);
      if (!project) {
        return res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: `Project '${projectId}' not found`,
          },
        });
      }

      if (!project.versions || project.versions.length === 0) {
        return res.status(400).json({
          error: {
            code: "NO_SAVED_VERSION",
            message: "Project has no saved versions. A saved version is required for export.",
          },
        });
      }

      // Resolve requested version or latest saved version
      let targetVersion;
      if (body.version !== undefined) {
        targetVersion = project.versions.find(
          (v) => v.versionNumber === body.version
        );
        if (!targetVersion) {
          return res.status(404).json({
            error: {
              code: "VERSION_NOT_FOUND",
              message: `Saved version ${body.version} not found in project '${projectId}'`,
            },
          });
        }
      } else {
        targetVersion = project.versions[project.versions.length - 1];
      }

      const assets = req.app.locals.assets;
      const photoSource = createDiskPhotoSource(
        projectId,
        targetVersion.people || []
      );

      const typography = targetVersion.draft?.look?.attributes?.typography;
      const exportFonts = assets.fontRegistry?.[typography] || assets.fonts;

      const acknowledgedWarnings = body.acknowledgedWarnings;

      // 1. Single card export
      if (body.kind === "card") {
        if (!body.personId) {
          return res.status(400).json({
            error: {
              code: "MISSING_PERSON_ID",
              message: "personId is required for single card export",
            },
          });
        }

        const person = (targetVersion.people || []).find(
          (p) => p.id === body.personId
        );
        if (!person) {
          return res.status(404).json({
            error: {
              code: "PERSON_NOT_FOUND",
              message: `Person '${body.personId}' not found in saved version`,
            },
          });
        }

        const cardSettings = {
          format: body.format || "pdf",
          mode: "single",
          ...(body.dpi ? { dpi: body.dpi } : {}),
        };

        const result = await exportCard(
          {
            eventSpec: project.eventSpec,
            draft: targetVersion.draft,
            person,
            photoSource,
            brand: assets.brandKit,
            fonts: exportFonts,
          },
          cardSettings,
          { acknowledgedWarnings }
        );

        if (!result.ok) {
          const combinedIssues = [
            ...(result.issues || []),
            ...(result.errors || []),
            ...(result.warnings || []),
          ];
          return res.status(422).json({
            error: {
              code:
                result.errors?.[0]?.code ||
                result.warnings?.[0]?.code ||
                "PREFLIGHT_FAILED",
              message: result.reason || "Card export preflight check failed (D-09)",
              issues: combinedIssues,
            },
          });
        }

        res.setHeader("Content-Type", result.mimeType || "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${result.fileName || "card.pdf"}"`
        );
        return res.send(result.data);
      }

      // 2. A4 / A3 print sheet export
      if (body.kind === "sheet") {
        const sheetFormat = body.format || "pdf";
        const sheetSettings = {
          format: sheetFormat,
          mode: "sheets",
          sheet: {
            paper: body.paper || "A4",
            ...(body.printerSafeMm !== undefined
              ? { printerSafeMm: body.printerSafeMm }
              : {}),
          },
          ...(body.dpi ? { dpi: body.dpi } : {}),
        };

        const result = await exportSheet(
          {
            eventSpec: project.eventSpec,
            draft: targetVersion.draft,
            people: targetVersion.people || [],
            photoSource,
            brand: assets.brandKit,
            fonts: exportFonts,
          },
          sheetSettings,
          { acknowledgedWarnings }
        );

        if (!result.ok) {
          const combinedIssues = [
            ...(result.issues || []),
            ...(result.errors || []),
            ...(result.warnings || []),
          ];
          return res.status(422).json({
            error: {
              code:
                result.errors?.[0]?.code ||
                result.warnings?.[0]?.code ||
                "PREFLIGHT_FAILED",
              message: result.reason || "Sheet export preflight check failed (D-09)",
              issues: combinedIssues,
            },
          });
        }

        res.setHeader(
          "Content-Type",
          result.mimeType || (sheetFormat === "svg" ? "image/svg+xml" : "application/pdf")
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${result.fileName || `print-sheets.${sheetFormat}`}"`
        );
        return res.send(result.data);
      }

      // 3. Batch ZIP export
      if (body.kind === "zip") {
        const zipSettings = {
          format: body.format || "pdf",
          mode: "all",
          ...(body.dpi ? { dpi: body.dpi } : {}),
        };

        const result = await exportZip(
          {
            eventSpec: project.eventSpec,
            draft: targetVersion.draft,
            people: targetVersion.people || [],
            photoSource,
            brand: assets.brandKit,
            fonts: exportFonts,
          },
          zipSettings,
          { acknowledgedWarnings }
        );

        if (!result.ok) {
          const combinedIssues = [
            ...(result.issues || []),
            ...(result.errors || []),
            ...(result.warnings || []),
          ];
          return res.status(422).json({
            error: {
              code:
                result.errors?.[0]?.code ||
                result.warnings?.[0]?.code ||
                "PREFLIGHT_FAILED",
              message: result.reason || "Batch export preflight check failed (D-09)",
              issues: combinedIssues,
            },
          });
        }

        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${result.fileName || "export.zip"}"`
        );
        return res.send(result.data);
      }

      return res.status(400).json({
        error: {
          code: "INVALID_EXPORT_KIND",
          message: `Unknown export kind '${body.kind}'`,
        },
      });
    } catch (err) {
      next(err);
    } finally {
      activeProjectExports.delete(projectId);
    }
  });

  return router;
}
