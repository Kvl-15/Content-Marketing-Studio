// @ts-check
/**
 * @module server/routes/intake
 * Express router for Intake workflow: parsing briefs, finding gaps,
 * serving questions, applying answers, and locking specs.
 */

import { Router } from "express";
import { z } from "zod";
import { parseBrief } from "../ai/gateway.js";
import { findGaps } from "../intake/gaps.js";
import { nextQuestions } from "../intake/questions.js";
import { applyAnswer } from "../intake/applyAnswer.js";
import { lockSpec } from "../intake/lockSpec.js";

const ParseBriefRequestSchema = z.object({
  brief: z.string().min(1, "Brief cannot be empty"),
  today: z.string().optional(),
});

const QuestionsRequestSchema = z.object({
  spec: z.record(z.string(), z.any()),
  declined: z.array(z.string()).optional(),
});

const AnswerRequestSchema = z.object({
  spec: z.record(z.string(), z.any()),
  answer: z.object({
    path: z.string().optional(),
    value: z.any().optional(),
    declined: z.boolean().optional(),
    action: z.enum(["confirm", "decline"]).optional(),
    answers: z
      .array(
        z.object({
          path: z.string(),
          value: z.any().optional(),
          declined: z.boolean().optional(),
          action: z.enum(["confirm", "decline"]).optional(),
        })
      )
      .optional(),
  }),
});

const LockRequestSchema = z.object({
  spec: z.record(z.string(), z.any()),
});

/**
 * Creates and configures the intake HTTP router.
 *
 * @returns {Router}
 */
export function createIntakeRouter() {
  const router = Router();

  /**
   * POST /intake/parse
   * Extracts EventSpec values from natural language brief using Gemini.
   */
  router.post("/intake/parse", async (req, res, next) => {
    try {
      const parsedBody = ParseBriefRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: "A non-empty brief string is required in the request body.",
            issues: parsedBody.error.issues,
          },
        });
      }

      const { brief, today } = parsedBody.data;
      const result = await parseBrief(brief, { today });

      if (!result.ok) {
        return res.status(422).json({
          error: {
            code: result.error.code,
            message: result.error.message,
          },
          emptySpec: result.emptySpec,
        });
      }

      return res.status(200).json({
        status: "ok",
        spec: result.spec,
        designType: result.designType,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /intake/questions
   * Returns next 3 to 5 questions in 2 or 3 steps alongside the 4 gap groups.
   */
  router.post("/intake/questions", (req, res, next) => {
    try {
      const parsedBody = QuestionsRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: "A valid spec object is required.",
            issues: parsedBody.error.issues,
          },
        });
      }

      const { spec, declined } = parsedBody.data;
      const questionsData = nextQuestions(spec, declined || []);
      const gaps = findGaps(spec);

      return res.status(200).json({
        status: "ok",
        ...questionsData,
        gaps,
        hasRequiredGaps: gaps.hasRequiredGaps,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /intake/answer
   * Applies an answer immutably to the spec.
   */
  router.post("/intake/answer", (req, res, next) => {
    try {
      const parsedBody = AnswerRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: "Spec and answer objects are required.",
            issues: parsedBody.error.issues,
          },
        });
      }

      const { spec, answer } = parsedBody.data;
      const result = applyAnswer(spec, answer);

      if (!result.ok) {
        return res.status(422).json({
          error: {
            code: result.error.code,
            message: result.error.message,
            path: result.error.path,
          },
        });
      }

      return res.status(200).json({
        status: "ok",
        spec: result.spec,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /intake/lock
   * Validates and locks an EventSpec.
   */
  router.post("/intake/lock", (req, res, next) => {
    try {
      const parsedBody = LockRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: "A valid spec object is required.",
            issues: parsedBody.error.issues,
          },
        });
      }

      const { spec } = parsedBody.data;
      const result = lockSpec(spec);

      if (!result.ok) {
        return res.status(422).json({
          error: {
            code: result.error.code,
            message: result.error.message,
            gaps: result.error.gaps,
            issues: result.error.issues,
          },
        });
      }

      return res.status(200).json({
        status: "ok",
        spec: result.spec,
        locked: true,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
