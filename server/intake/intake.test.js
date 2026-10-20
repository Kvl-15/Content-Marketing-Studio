// @ts-check
import { describe, it, expect } from "vitest";
import {
  emptySpec,
  findGaps,
  isValidCalendarDate,
  nextQuestions,
  applyAnswer,
  hexLightness,
  lockSpec,
} from "./index.js";

describe("Task I: Intake Module Tests", () => {
  describe("1. emptySpec", () => {
    it("creates an empty spec with unknown statuses and CR80 portrait defaults", () => {
      const spec = emptySpec("id-card");
      expect(spec.schemaVersion).toBe(1);
      expect(spec.designType).toBe("id-card");
      expect(spec.event.name).toEqual({ value: null, status: "unknown" });
      expect(spec.event.dates).toEqual({ value: null, status: "unknown" });
      expect(spec.event.venue).toEqual({ value: null, status: "unknown" });
      expect(spec.roles).toEqual([]);
      expect(spec.fields).toEqual({ value: null, status: "unknown" });

      // CR80 defaults
      expect(spec.card.widthMm).toBe(54);
      expect(spec.card.heightMm).toBe(85.6);
      expect(spec.card.orientation).toBe("portrait");
      expect(spec.card.bleedMm).toBe(3);
      expect(spec.card.safeMarginMm).toBe(3);
      expect(spec.card.sides).toBe("front");
      expect(spec.qr.enabled).toBe(false);
    });

    it("leaves designType unset (null) when unknown design type is passed", () => {
      const spec = emptySpec("brochure");
      expect(spec.designType).toBeNull();
    });
  });

  describe("2. isValidCalendarDate", () => {
    it("accepts real calendar dates", () => {
      expect(isValidCalendarDate("2026-10-20")).toBe(true);
      expect(isValidCalendarDate("2024-02-29")).toBe(true); // leap year
      expect(isValidCalendarDate("2026-12-31")).toBe(true);
    });

    it("rejects invalid calendar dates", () => {
      expect(isValidCalendarDate("2026-02-29")).toBe(false); // not leap year
      expect(isValidCalendarDate("2026-02-30")).toBe(false);
      expect(isValidCalendarDate("2026-04-31")).toBe(false); // April has 30 days
      expect(isValidCalendarDate("2026-13-01")).toBe(false);
      expect(isValidCalendarDate("not-a-date")).toBe(false);
      expect(isValidCalendarDate(12345)).toBe(false);
    });
  });

  describe("3. findGaps", () => {
    it("categorises an empty spec into the 4 groups from KB 7.3", () => {
      const spec = emptySpec("id-card");
      const gaps = findGaps(spec);

      expect(gaps.hasRequiredGaps).toBe(true);

      const requiredPaths = gaps.required.map((g) => g.path);
      expect(requiredPaths).toContain("event.name");
      expect(requiredPaths).toContain("event.venue");
      expect(requiredPaths).toContain("event.dates");
      expect(requiredPaths).toContain("roles");
      expect(requiredPaths).toContain("fields");

      const defaultedPaths = gaps.defaulted.map((g) => g.path);
      expect(defaultedPaths).toContain("card.size");
      expect(defaultedPaths).toContain("card.bleedMm");
      expect(defaultedPaths).toContain("card.safeMarginMm");
      expect(defaultedPaths).toContain("card.orientation");
      expect(defaultedPaths).toContain("card.sides");

      const optionalPaths = gaps.optional.map((g) => g.path);
      expect(optionalPaths).toContain("event.tagline");
      expect(optionalPaths).toContain("event.palette");
    });

    it("flags unconfirmed suggestions as required gaps", () => {
      const spec = emptySpec("id-card");
      // Value with status "suggestion" never counts as provided
      spec.event.name = {
        value: "Suggested Hackathon",
        status: "suggestion",
        source: "suggestion",
        confirmed: false,
      };

      const gaps = findGaps(spec);
      const nameGap = gaps.required.find((g) => g.path === "event.name");
      expect(nameGap).toBeDefined();
      expect(nameGap?.reason).toBe("unconfirmed_suggestion");
    });

    it("does not count declined optional fields as gaps", () => {
      const spec = emptySpec("id-card");
      spec.event.tagline = {
        value: null,
        status: "declined",
        source: "answer",
        confirmed: true,
      };

      const gaps = findGaps(spec);
      const taglineGap = gaps.optional.find((g) => g.path === "event.tagline");
      expect(taglineGap).toBeUndefined();
    });

    it("flags missing role labels and empty roles list", () => {
      const spec = emptySpec("id-card");
      spec.roles = [{ id: "bad", label: "", expectedCount: 10, color: { value: "#1E3A8A", status: "provided" } }];
      const gaps = findGaps(spec);
      expect(gaps.required.some((g) => g.path === "roles[0].label")).toBe(true);
    });
  });

  describe("4. nextQuestions", () => {
    it("returns 3 to 5 questions in step order, never asking QR or photo questions", () => {
      const spec = emptySpec("id-card");
      const res = nextQuestions(spec);

      expect(res.questions.length).toBeGreaterThanOrEqual(3);
      expect(res.questions.length).toBeLessThanOrEqual(5);
      expect(res.currentStep).toBe(1);

      // Verify no QR or photo questions (D-39)
      const questionTexts = res.questions.map((q) => q.question.toLowerCase() + " " + q.path);
      for (const text of questionTexts) {
        expect(text).not.toContain("qr");
        expect(text).not.toContain("how will photos");
      }
    });

    it("never asks questions that the user has explicitly declined", () => {
      const spec = emptySpec("id-card");
      const res = nextQuestions(spec, ["event.tagline"]);
      expect(res.questions.some((q) => q.path === "event.tagline")).toBe(false);
    });

    it("advances to Step 2 when Step 1 questions are satisfied", () => {
      const spec = emptySpec("id-card");
      spec.event.name = { value: "Hackathon 2026", status: "provided", source: "brief", confirmed: true };
      spec.event.venue = { value: "SVNIT Campus", status: "provided", source: "brief", confirmed: true };
      spec.event.dates = { value: ["2026-10-20"], status: "provided", source: "brief", confirmed: true };

      const res = nextQuestions(spec);
      expect(res.currentStep).toBe(2);
      expect(res.questions.some((q) => q.path === "roles")).toBe(true);
      expect(res.questions.some((q) => q.path === "fields")).toBe(true);
    });
  });

  describe("5. applyAnswer", () => {
    it("returns a new validated spec and never mutates the input spec", () => {
      const original = emptySpec("id-card");
      const copy = JSON.parse(JSON.stringify(original));

      const res = applyAnswer(original, {
        path: "event.name",
        value: "ACM Annual Tech Meet",
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.spec.event.name.value).toBe("ACM Annual Tech Meet");
        expect(res.spec.event.name.status).toBe("provided");
      }
      // Ensure original is untouched
      expect(original).toEqual(copy);
    });

    it("converts role ids into lowercase slugs", () => {
      const spec = emptySpec("id-card");
      const res = applyAnswer(spec, {
        path: "roles",
        value: [
          { label: "Core Organizer", expectedCount: 15 },
          { label: "VIP / Guest Speaker", expectedCount: 5 },
          { label: "PARTICIPANT", expectedCount: 200 },
        ],
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.spec.roles[0].id).toBe("core-organizer");
        expect(res.spec.roles[1].id).toBe("vip-guest-speaker");
        expect(res.spec.roles[2].id).toBe("participant");
      }
    });

    it("ensures default role colors are at least 15% apart in lightness", () => {
      const spec = emptySpec("id-card");
      const res = applyAnswer(spec, {
        path: "roles",
        value: ["Organizer", "Mentor", "Participant", "Volunteer"],
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        const roles = res.spec.roles;
        for (let i = 1; i < roles.length; i++) {
          const lPrev = hexLightness(roles[i - 1].color.value);
          const lCurr = hexLightness(roles[i].color.value);
          const diff = Math.abs(lCurr - lPrev);
          expect(diff).toBeGreaterThanOrEqual(15);
        }
      }
    });

    it("validates that dates are real calendar dates", () => {
      const spec = emptySpec("id-card");

      // Valid date
      const okRes = applyAnswer(spec, {
        path: "event.dates",
        value: ["2026-10-20"],
      });
      expect(okRes.ok).toBe(true);

      // Invalid date (Feb 30)
      const badRes = applyAnswer(spec, {
        path: "event.dates",
        value: ["2026-02-30"],
      });
      expect(badRes.ok).toBe(false);
      if (!badRes.ok) {
        expect(badRes.error.code).toBe("INVALID_CALENDAR_DATE");
      }
    });

    it("supports confirming a brief-parsed value without retyping (action: confirm)", () => {
      const spec = emptySpec("id-card");
      // Simulate brief parser prefill
      spec.event.name = {
        value: "24-hour Hackathon",
        status: "provided",
        source: "brief",
        confirmed: false,
      };

      const res = applyAnswer(spec, {
        path: "event.name",
        action: "confirm",
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.spec.event.name.value).toBe("24-hour Hackathon");
        expect(res.spec.event.name.confirmed).toBe(true);
        expect(res.spec.event.name.source).toBe("brief");
      }
    });

    it("supports declining an optional field (action: decline)", () => {
      const spec = emptySpec("id-card");
      spec.event.tagline = {
        value: "Some tagline",
        status: "provided",
        source: "brief",
        confirmed: false,
      };

      const res = applyAnswer(spec, {
        path: "event.tagline",
        action: "decline",
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.spec.event.tagline.value).toBeNull();
        expect(res.spec.event.tagline.status).toBe("declined");
        expect(res.spec.event.tagline.confirmed).toBe(true);
      }
    });

    it("returns error when trying to confirm an empty/missing field", () => {
      const spec = emptySpec("id-card");
      const res = applyAnswer(spec, {
        path: "event.name",
        action: "confirm",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("CANNOT_CONFIRM_EMPTY");
      }
    });

    it("refuses decline requests for required fields", () => {
      const spec = emptySpec("id-card");
      const res = applyAnswer(spec, {
        path: "event.name",
        declined: true,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("CANNOT_DECLINE_REQUIRED");
      }
    });

    it("refuses landscape, back sides, and QR toggle per D-39", () => {
      const spec = emptySpec("id-card");

      const landscapeRes = applyAnswer(spec, {
        path: "card.orientation",
        value: "landscape",
      });
      expect(landscapeRes.ok).toBe(false);
      if (!landscapeRes.ok) {
        expect(landscapeRes.error.code).toBe("UNSUPPORTED_CONFIGURATION");
      }

      const backSidesRes = applyAnswer(spec, {
        path: "card.sides",
        value: "both",
      });
      expect(backSidesRes.ok).toBe(false);
      if (!backSidesRes.ok) {
        expect(backSidesRes.error.code).toBe("UNSUPPORTED_CONFIGURATION");
      }

      const qrRes = applyAnswer(spec, {
        path: "qr.enabled",
        value: true,
      });
      expect(qrRes.ok).toBe(false);
      if (!qrRes.ok) {
        expect(qrRes.error.code).toBe("UNSUPPORTED_CONFIGURATION");
      }
    });
  });

  describe("6. lockSpec", () => {
    it("refuses to lock a spec with required gaps", () => {
      const spec = emptySpec("id-card");
      const res = lockSpec(spec);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("SPEC_HAS_GAPS");
      }
    });

    it("refuses to lock a spec with unconfirmed suggestions", () => {
      const spec = emptySpec("id-card");
      spec.event.name = { value: "Hackathon", status: "provided", source: "answer", confirmed: true };
      spec.event.venue = { value: "SVNIT", status: "provided", source: "answer", confirmed: true };
      spec.event.dates = { value: ["2026-10-20"], status: "provided", source: "answer", confirmed: true };
      spec.roles = [
        {
          id: "participant",
          label: "Participant",
          expectedCount: 100,
          color: { value: "#1E3A8A", status: "provided", source: "answer", confirmed: true },
        },
      ];
      spec.fields = { value: ["name", "role"], status: "provided", source: "answer", confirmed: true };
      spec.event.tagline = {
        value: "Innovate now",
        status: "suggestion", // unconfirmed suggestion!
        source: "suggestion",
        confirmed: false,
      };

      const res = lockSpec(spec);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("UNCONFIRMED_SUGGESTION");
      }
    });

    it("successfully locks a fully valid spec and returns it frozen", () => {
      const spec = emptySpec("id-card");
      spec.event.name = { value: "Hackathon 2026", status: "provided", source: "answer", confirmed: true };
      spec.event.tagline = { value: null, status: "declined", source: "answer", confirmed: true };
      spec.event.venue = { value: "SVNIT Campus", status: "provided", source: "answer", confirmed: true };
      spec.event.dates = { value: ["2026-10-20"], status: "provided", source: "answer", confirmed: true };
      spec.roles = [
        {
          id: "participant",
          label: "Participant",
          expectedCount: 100,
          color: { value: "#1E3A8A", status: "provided", source: "answer", confirmed: true },
        },
      ];
      spec.fields = { value: ["name", "role", "org"], status: "provided", source: "answer", confirmed: true };

      const res = lockSpec(spec);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(Object.isFrozen(res.spec)).toBe(true);
        expect(res.spec.event.name.value).toBe("Hackathon 2026");
      }
    });
  });
});
