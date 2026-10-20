// @ts-check
import { Router } from "express";
import express from "express";
import { z } from "zod";
import { ProjectIdSchema, ensureProjectPhotoDir } from "../storage/schemas.js";
import {
  buildDataset,
  parseInput,
  detectHeaderRow,
  mappingProposal,
  DATA_LIMITS,
  DataValidationError,
  DataParseError,
  UnsupportedFormatError,
} from "../data/index.js";

const DataQuerySchema = z.object({
  kind: z.enum(["csv", "xlsx", "json"]).optional(),
  mapping: z.string().optional(),
});

export function createDataRouter() {
  const router = Router();

  // POST /projects/:id/data - raw tabular data upload
  router.post(
    "/projects/:id/data",
    express.raw({
      type: "*/*",
      limit: DATA_LIMITS.maxInputBytes,
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

        const queryParse = DataQuerySchema.safeParse(req.query);
        if (!queryParse.success) {
          return res.status(400).json({
            error: {
              code: "INVALID_QUERY_PARAMS",
              message: queryParse.error.issues
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

        if (!req.body || (Buffer.isBuffer(req.body) && req.body.length === 0)) {
          return res.status(400).json({
            error: {
              code: "EMPTY_BODY",
              message: "Uploaded tabular data body cannot be empty",
            },
          });
        }

        let mapping = null;
        if (queryParse.data.mapping) {
          try {
            mapping = JSON.parse(queryParse.data.mapping);
          } catch {
            return res.status(400).json({
              error: {
                code: "INVALID_MAPPING",
                message: "Mapping parameter must be valid JSON",
              },
            });
          }
        }

        // Auto-propose mapping if none provided
        if (!mapping) {
          try {
            const parsed = parseInput(req.body);
            const header = detectHeaderRow(parsed.rows);
            const proposal = mappingProposal(header.headers);
            mapping = proposal.mapping;
          } catch (err) {
            if (
              err instanceof UnsupportedFormatError ||
              err instanceof DataParseError
            ) {
              return res.status(400).json({
                error: {
                  code: err.code || "PARSE_ERROR",
                  message: err.message,
                },
              });
            }
            throw err;
          }
        }

        const photoDir = await ensureProjectPhotoDir(project.id);

        let result;
        try {
          result = await buildDataset(req.body, {
            eventSpec: project.eventSpec,
            eventCode: project.eventCode,
            mapping,
            outputDir: photoDir,
          });
        } catch (err) {
          if (err instanceof DataValidationError) {
            return res.status(422).json({
              error: {
                code: err.code || "VALIDATION_ERROR",
                message: err.message,
                ...(err.details?.proposal
                  ? { issues: err.details.proposal.unmappedHeaders || [] }
                  : {}),
              },
            });
          }
          if (
            err instanceof UnsupportedFormatError ||
            err instanceof DataParseError
          ) {
            return res.status(400).json({
              error: {
                code: err.code || "PARSE_ERROR",
                message: err.message,
              },
            });
          }
          throw err;
        }

        // Check if zero valid participants remain (e.g. all rows had fatal errors)
        if (!result.people || result.people.length === 0) {
          const errorIssues = result.report.rows
            .flatMap((r) => r.issues || [])
            .filter((i) => i.severity === "error");

          const firstCode = errorIssues[0]?.code || "DATA_VALIDATION_ERROR";

          return res.status(422).json({
            error: {
              code: firstCode,
              message: "Dataset validation failed: zero valid participants found",
              issues: errorIssues,
            },
            report: result.report,
          });
        }

        // Store cleaned people rows and A2 dataset report (valid people only, errors excluded)
        await storage.addDatasetReport(project.id, {
          report: result.report,
          people: result.people,
        });

        // Response contains only the A2 report (personal data privacy: no people array)
        res.json({ report: result.report });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
