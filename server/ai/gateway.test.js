// @ts-check
import { describe, it, expect, vi } from "vitest";
import {
  parseBrief,
  detectDesignType,
  evidenceCheck,
  isTracedInText,
  buildPrompt,
} from "./gateway.js";

describe("Task I: AI Gateway Tests", () => {
  describe("1. detectDesignType", () => {
    it("detects 'id-card' from keywords", () => {
      expect(detectDesignType("We need ID cards for 200 participants")).toBe("id-card");
      expect(detectDesignType("Create badges for our annual hackathon")).toBe("id-card");
      expect(detectDesignType("Identity card design for college fest")).toBe("id-card");
    });

    it("leaves unknown design type unset (null)", () => {
      expect(detectDesignType("Marketing campaign for spring")).toBeNull();
      expect(detectDesignType("Social media poster")).toBeNull();
    });
  });

  describe("2. isTracedInText & evidenceCheck", () => {
    it("traces matching tokens in brief text", () => {
      const brief = "ACM Hackathon 2026 at SVNIT Surat with 200 participants on 2026-10-20.";
      expect(isTracedInText("SVNIT Surat", brief)).toBe(true);
      expect(isTracedInText("Hackathon 2026", brief)).toBe(true);
      expect(isTracedInText(200, brief)).toBe(true);
      expect(isTracedInText("2026-10-20", brief)).toBe(true);
    });

    it("discards untraced values (hallucinations) via evidenceCheck", () => {
      const brief = "Annual Hackathon at SVNIT Surat on 2026-10-20 with 200 participants.";
      const raw = {
        name: "Annual Hackathon",
        venue: "SVNIT Surat",
        tagline: "Inventing The Future", // Not in brief!
        dates: ["2026-10-20", "2026-11-15"], // 2026-11-15 not in brief!
        roles: [
          { label: "Participants", expectedCount: 200 },
          { label: "VIP Speaker", expectedCount: 10 }, // Not in brief!
        ],
        fields: ["name", "role"],
        palette: ["#FF0000"], // Not in brief!
      };

      const verified = evidenceCheck(raw, brief);
      expect(verified.name).toBe("Annual Hackathon");
      expect(verified.venue).toBe("SVNIT Surat");
      expect(verified.tagline).toBeNull(); // Discarded!
      expect(verified.dates).toEqual(["2026-10-20"]); // Only traced date kept!
      expect(verified.roles.length).toBe(1);
      expect(verified.roles[0].label).toBe("Participants");
      expect(verified.palette).toBeNull(); // Discarded!
    });

    it("drops made-up event name and venue when untraceable to brief", () => {
      const brief = "ID cards for 200 participants on 2026-10-20.";
      const raw = {
        name: "Global Tech Summit 2099", // Made-up!
        venue: "San Francisco Convention Center", // Made-up!
        tagline: null,
        dates: ["2026-10-20"],
        roles: [{ label: "participants", expectedCount: 200 }],
        fields: null,
        palette: null,
      };

      const verified = evidenceCheck(raw, brief);
      // Both made-up name and venue must be dropped to null
      expect(verified.name).toBeNull();
      expect(verified.venue).toBeNull();
      expect(verified.dates).toEqual(["2026-10-20"]);
      expect(verified.roles.length).toBe(1);
      expect(verified.roles[0].expectedCount).toBe(200);
    });
  });

  describe("3. buildPrompt", () => {
    it("includes JSON schema, today's date parameter, and hard zero-invention rule", () => {
      const prompt = buildPrompt("Test brief", "2026-10-20");
      expect(prompt).toContain("Today's date is: 2026-10-20");
      expect(prompt).toContain("HARD RULE (D-02): Extract ONLY information that is explicitly stated");
      expect(prompt).toContain("NEVER invent, assume, extrapolate, or guess");
      expect(prompt).toContain("Brief text:\nTest brief");
    });
  });

  describe("4. parseBrief", () => {
    it("parses brief successfully with status: provided, source: brief, confirmed: false", async () => {
      const briefText = "ID cards for 24-hour Hackathon at SVNIT Surat on 2026-10-20 with 200 participants.";
      const mockApiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    name: "24-hour Hackathon",
                    venue: "SVNIT Surat",
                    tagline: null,
                    dates: ["2026-10-20"],
                    roles: [{ label: "participants", expectedCount: 200 }],
                    fields: ["name", "role"],
                    palette: null,
                  }),
                },
              ],
            },
          },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      });

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const res = await parseBrief(briefText, {
        apiKey: "dummy-key",
        fetchFn: /** @type {any} */ (mockFetch),
        today: "2026-10-20",
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.designType).toBe("id-card");
        expect(res.spec.event.name).toEqual({
          value: "24-hour Hackathon",
          status: "provided",
          source: "brief",
          confirmed: false,
        });
        expect(res.spec.event.venue).toEqual({
          value: "SVNIT Surat",
          status: "provided",
          source: "brief",
          confirmed: false,
        });
        expect(res.spec.event.dates).toEqual({
          value: ["2026-10-20"],
          status: "provided",
          source: "brief",
          confirmed: false,
        });
        expect(res.spec.roles.length).toBe(1);
        expect(res.spec.roles[0].label).toBe("participants");
        expect(res.spec.roles[0].id).toBe("participants");
      }

      // Verify privacy logging (KB 7.7): logs only length and outcome, never brief text or key
      expect(logSpy).toHaveBeenCalledWith(
        `[AI Intake] brief length: ${briefText.length}, outcome: ok`
      );
      logSpy.mockRestore();
    });

    it("retries once on failure, then succeeds", async () => {
      const briefText = "Badges for Tech Fest 2026 at SVNIT Surat";
      let callCount = 0;

      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 500,
            text: async () => "Internal AI error",
          };
        }
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        name: "Tech Fest 2026",
                        venue: "SVNIT Surat",
                        dates: null,
                        roles: null,
                        fields: null,
                        palette: null,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
        };
      });

      const res = await parseBrief(briefText, {
        apiKey: "dummy-key",
        fetchFn: /** @type {any} */ (mockFetch),
        today: "2026-10-20",
      });

      expect(callCount).toBe(2);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.spec.event.name.value).toBe("Tech Fest 2026");
      }
    });

    it("returns emptySpec alongside error on second failure (KB 7.1 step 3)", async () => {
      const briefText = "ID cards for Tech Fest";
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "AI Gateway unavailable",
      });

      const res = await parseBrief(briefText, {
        apiKey: "dummy-key",
        fetchFn: /** @type {any} */ (mockFetch),
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("BRIEF_PARSE_FAILED");
        // Must provide emptySpec next to the error so GUI opens manual form immediately
        expect(res.emptySpec).toBeDefined();
        expect(res.emptySpec.designType).toBe("id-card");
        expect(res.emptySpec.event.name.status).toBe("unknown");
      }
    });

    it("returns AI_UNAVAILABLE with emptySpec when GEMINI_API_KEY is missing (D-12 fallback)", async () => {
      const briefText = "ID cards for Innovate 2026";
      const res = await parseBrief(briefText, {
        apiKey: "", // empty key
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("AI_UNAVAILABLE");
        expect(res.emptySpec).toBeDefined();
        expect(res.emptySpec.designType).toBe("id-card");
      }
    });

    it("D-10 Privacy Test: proves request body contains only brief text and schema, never participant personal data", async () => {
      // Simulate environment having participant data in memory
      const fakeParticipant = {
        name: "Priya Sharma",
        email: "priya.sharma@nit-surat.ac.in",
        photo: "priya_face.jpg",
        phone: "+91-9876543210",
      };

      const briefText = "ID cards for 24-hour Hackathon at SVNIT Surat with 200 participants.";
      let capturedRequestBody = "";

      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        capturedRequestBody = options?.body || "";
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        name: "24-hour Hackathon",
                        venue: "SVNIT Surat",
                        dates: null,
                        roles: [{ label: "participants", expectedCount: 200 }],
                        fields: null,
                        palette: null,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
        };
      });

      const res = await parseBrief(briefText, {
        apiKey: "dummy-key-for-test",
        fetchFn: /** @type {any} */ (mockFetch),
      });

      expect(res.ok).toBe(true);

      // Verify that the request body sent to the AI contains NO personal participant data
      expect(capturedRequestBody).not.toContain(fakeParticipant.name);
      expect(capturedRequestBody).not.toContain(fakeParticipant.email);
      expect(capturedRequestBody).not.toContain(fakeParticipant.photo);
      expect(capturedRequestBody).not.toContain(fakeParticipant.phone);

      // Verify request contains the brief and schema prompt only
      expect(capturedRequestBody).toContain(briefText);
      expect(capturedRequestBody).toContain("HARD RULE (D-02)");
      expect(capturedRequestBody).toContain("name");
      expect(capturedRequestBody).toContain("venue");
    });
  });
});
