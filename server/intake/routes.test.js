// @ts-check
import { describe, it, expect } from "vitest";
import { createIntakeRouter } from "../routes/intake.js";
import { emptySpec } from "./emptySpec.js";

/**
 * Lightweight in-memory request dispatcher for Express router without network/sockets.
 *
 * @param {import("express").Router} router
 * @param {{
 *   method: string;
 *   url: string;
 *   body?: any;
 * }} reqData
 * @returns {Promise<{ status: number; body: any }>}
 */
function dispatch(router, reqData) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    let responseBody = null;

    const req = {
      method: reqData.method,
      url: reqData.url,
      path: reqData.url,
      body: reqData.body || {},
      headers: { "content-type": "application/json" },
    };

    const res = {
      status(code) {
        statusCode = code;
        return res;
      },
      json(data) {
        responseBody = data;
        resolve({ status: statusCode, body: responseBody });
        return res;
      },
      send(data) {
        responseBody = data;
        resolve({ status: statusCode, body: responseBody });
        return res;
      },
    };

    // @ts-ignore
    router.handle(req, res, (err) => {
      if (err) reject(err);
      else resolve({ status: 404, body: { error: "Not Handled" } });
    });
  });
}

describe("Task I: Intake HTTP Routes", () => {
  const router = createIntakeRouter();

  describe("POST /intake/parse", () => {
    it("returns 400 when brief is missing", async () => {
      const res = await dispatch(router, {
        method: "POST",
        url: "/intake/parse",
        body: {},
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_REQUEST");
    });

    it("returns 422 with emptySpec when AI is unavailable (form fallback)", async () => {
      const originalEnv = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const res = await dispatch(router, {
        method: "POST",
        url: "/intake/parse",
        body: { brief: "ID cards for Hackathon 2026" },
      });

      process.env.GEMINI_API_KEY = originalEnv;

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("AI_UNAVAILABLE");
      expect(res.body.emptySpec).toBeDefined();
      expect(res.body.emptySpec.designType).toBe("id-card");
    });
  });

  describe("POST /intake/questions", () => {
    it("returns 200 with next 3 to 5 questions AND the 4 gap groups", async () => {
      const spec = emptySpec("id-card");
      const res = await dispatch(router, {
        method: "POST",
        url: "/intake/questions",
        body: { spec },
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.questions.length).toBeGreaterThanOrEqual(3);
      expect(res.body.questions.length).toBeLessThanOrEqual(5);

      // Verify combined gap groups (Requirement 1)
      expect(res.body.hasRequiredGaps).toBe(true);
      expect(res.body.gaps).toBeDefined();
      expect(res.body.gaps.required.length).toBeGreaterThan(0);
      expect(res.body.gaps.defaulted.length).toBeGreaterThan(0);
      expect(res.body.gaps.optional.length).toBeGreaterThan(0);
      expect(res.body.gaps.derived).toBeDefined();
    });
  });

  describe("POST /intake/answer", () => {
    it("returns 200 with updated spec when applying valid answer", async () => {
      const spec = emptySpec("id-card");
      const res = await dispatch(router, {
        method: "POST",
        url: "/intake/answer",
        body: {
          spec,
          answer: {
            path: "event.name",
            value: "ACM Regional Convention",
          },
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.spec.event.name.value).toBe("ACM Regional Convention");
      expect(res.body.spec.event.name.status).toBe("provided");
    });

    it("supports confirming a brief-parsed value without retyping (action: confirm)", async () => {
      const spec = emptySpec("id-card");
      spec.event.name = {
        value: "24-hour Hackathon",
        status: "provided",
        source: "brief",
        confirmed: false,
      };

      const res = await dispatch(router, {
        method: "POST",
        url: "/intake/answer",
        body: {
          spec,
          answer: {
            path: "event.name",
            action: "confirm",
          },
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.spec.event.name.confirmed).toBe(true);
      expect(res.body.spec.event.name.value).toBe("24-hour Hackathon");
    });

    it("returns 422 when attempting to decline a required field", async () => {
      const spec = emptySpec("id-card");
      const res = await dispatch(router, {
        method: "POST",
        url: "/intake/answer",
        body: {
          spec,
          answer: {
            path: "event.name",
            action: "decline",
          },
        },
      });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("CANNOT_DECLINE_REQUIRED");
    });
  });

  describe("POST /intake/lock", () => {
    it("returns 422 with SPEC_HAS_GAPS when required gaps exist", async () => {
      const spec = emptySpec("id-card");
      const res = await dispatch(router, {
        method: "POST",
        url: "/intake/lock",
        body: { spec },
      });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("SPEC_HAS_GAPS");
      expect(res.body.error.gaps.length).toBeGreaterThan(0);
    });

    it("returns 200 and locked spec when all requirements are met", async () => {
      const spec = emptySpec("id-card");
      spec.event.name = { value: "Full Stack Fest 2026", status: "provided", source: "answer", confirmed: true };
      spec.event.tagline = { value: null, status: "declined", source: "answer", confirmed: true };
      spec.event.venue = { value: "SVNIT Surat", status: "provided", source: "answer", confirmed: true };
      spec.event.dates = { value: ["2026-10-20"], status: "provided", source: "answer", confirmed: true };
      spec.roles = [
        {
          id: "participant",
          label: "Participant",
          expectedCount: 150,
          color: { value: "#1E3A8A", status: "provided", source: "answer", confirmed: true },
        },
      ];
      spec.fields = { value: ["name", "role", "org"], status: "provided", source: "answer", confirmed: true };

      const res = await dispatch(router, {
        method: "POST",
        url: "/intake/lock",
        body: { spec },
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.locked).toBe(true);
      expect(res.body.spec.event.name.value).toBe("Full Stack Fest 2026");
    });
  });
});
