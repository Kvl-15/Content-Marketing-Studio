// @ts-check
import { Router } from "express";
import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { ProjectIdSchema, ensureProjectPhotoDir } from "../storage/schemas.js";
import { processPhotoZip, DATA_LIMITS } from "../data/index.js";

export function createPhotosRouter() {
  const router = Router();

  // POST /projects/:id/photos - raw ZIP archive upload
  router.post(
    "/projects/:id/photos",
    express.raw({
      type: "*/*",
      limit: DATA_LIMITS.maxZipBytes,
    }),
    async (req, res, next) => {
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

        if (!project.people || project.people.length === 0) {
          return res.status(400).json({
            error: {
              code: "NO_DATASET",
              message: "Upload tabular data before uploading photos",
            },
          });
        }

        if (!req.body || (Buffer.isBuffer(req.body) && req.body.length === 0)) {
          return res.status(400).json({
            error: {
              code: "EMPTY_BODY",
              message: "Uploaded photo ZIP cannot be empty",
            },
          });
        }

        const photoDir = await ensureProjectPhotoDir(project.id);

        const photoSet = await processPhotoZip(req.body, project.people, {
          outputDir: photoDir,
          writePhoto: async (row, processed) => {
            const safeName = String(row.id).replace(/[^A-Za-z0-9._-]/g, "_");
            const filename = `${safeName}.jpg`;
            const outputPath = path.join(photoDir, filename);
            await fs.writeFile(outputPath, processed.buffer);
            return outputPath;
          },
        });

        // Update matched people in storage
        const matchedMap = new Map();
        for (const match of photoSet.matches) {
          if (match.id) {
            matchedMap.set(match.id, `${match.id}.jpg`);
          }
        }

        const updatedPeople = project.people.map((person) => {
          if (matchedMap.has(person.id)) {
            return {
              ...person,
              photo: matchedMap.get(person.id),
              flags: (person.flags || []).filter((f) => f !== "NO_PHOTO"),
            };
          }
          return person;
        });

        await storage.addDatasetReport(project.id, {
          report: project.datasetReport,
          people: updatedPeople,
        });

        res.json({
          matches: photoSet.matches,
          unmatchedFiles: photoSet.unmatchedFiles,
          unmatchedRows: photoSet.unmatchedRows,
          warnings: photoSet.warnings,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
