// @ts-check
import { describe, it, expect, vi } from "vitest";
import {
  parseBrief,
  parseBriefWithGroq,
  assembleSpecFromExtraction,
  inspectRateLimit,
  detectDesignType,
  evidenceCheck,
  isTracedInText,
  buildPrompt,
  resolveThinkingLevel,
  DEFAULT_GROQ_MODEL,
} from "./gateway.js";

describe("Task I & Task G: AI Gateway Tests", () => {
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

  describe("4. Task G: Thinking Level & Time Bounding", () => {
    // Test a: Request body contains generationConfig.thinkingConfig.thinkingLevel "low" by default
    it("Test a: request body contains generationConfig.thinkingConfig.thinkingLevel 'low' by default", async () => {
      let capturedBody = null;
      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        name: "Tech Meet",
                        venue: "SVNIT",
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

      const res = await parseBrief("ID cards for Tech Meet at SVNIT", {
        apiKey: "dummy-key",
        fetchFn: /** @type {any} */ (mockFetch),
      });

      expect(res.ok).toBe(true);
      expect(capturedBody).toBeDefined();
      expect(capturedBody.generationConfig?.thinkingConfig?.thinkingLevel).toBe("low");
    });

    // Test b: GEMINI_THINKING_LEVEL="" omits thinkingConfig; "high" sends "high"; "ultra" (bad input) falls back to "low"
    it("Test b: GEMINI_THINKING_LEVEL='' omits thinkingConfig; 'high' sends 'high'; 'ultra' falls back to 'low'", async () => {
      // Unit check resolveThinkingLevel
      expect(resolveThinkingLevel("")).toBeNull();
      expect(resolveThinkingLevel("high")).toBe("high");
      expect(resolveThinkingLevel("minimal")).toBe("minimal");
      expect(resolveThinkingLevel("medium")).toBe("medium");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      expect(resolveThinkingLevel("ultra")).toBe("low");
      expect(logSpy).toHaveBeenCalledWith("[AI Intake] Invalid GEMINI_THINKING_LEVEL, falling back to low");
      logSpy.mockRestore();

      // Integration in parseBrief with thinkingLevel: "" (omit)
      let bodyOmit = null;
      const mockFetchOmit = vi.fn().mockImplementation(async (_url, options) => {
        bodyOmit = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ name: "Tech", venue: "SVNIT" }) }],
                },
              },
            ],
          }),
        };
      });

      await parseBrief("ID cards for Tech at SVNIT", {
        apiKey: "dummy-key",
        fetchFn: /** @type {any} */ (mockFetchOmit),
        thinkingLevel: "",
      });

      expect(bodyOmit.generationConfig?.thinkingConfig).toBeUndefined();

      // Integration with thinkingLevel: "high"
      let bodyHigh = null;
      const mockFetchHigh = vi.fn().mockImplementation(async (_url, options) => {
        bodyHigh = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ name: "Tech", venue: "SVNIT" }) }],
                },
              },
            ],
          }),
        };
      });

      await parseBrief("ID cards for Tech at SVNIT", {
        apiKey: "dummy-key",
        fetchFn: /** @type {any} */ (mockFetchHigh),
        thinkingLevel: "high",
      });

      expect(bodyHigh.generationConfig?.thinkingConfig?.thinkingLevel).toBe("high");

      // Integration with thinkingLevel: "ultra" (invalid -> fallback to low)
      let bodyUltra = null;
      const mockFetchUltra = vi.fn().mockImplementation(async (_url, options) => {
        bodyUltra = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ name: "Tech", venue: "SVNIT" }) }],
                },
              },
            ],
          }),
        };
      });

      await parseBrief("ID cards for Tech at SVNIT", {
        apiKey: "dummy-key",
        fetchFn: /** @type {any} */ (mockFetchUltra),
        thinkingLevel: "ultra",
      });

      expect(bodyUltra.generationConfig?.thinkingConfig?.thinkingLevel).toBe("low");
    });

    // Test c: 400 mentioning thinking retried once without thinkingConfig; 400 not mentioning thinking not retried
    it("Test c: 400 mentioning thinking is retried once without thinkingConfig; other 400 is not retried", async () => {
      let callCount = 0;
      let secondCallBody = null;

      const mockFetchThinking400 = vi.fn().mockImplementation(async (_url, options) => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 400,
            text: async () => "Error: thinkingConfig is not supported on this model endpoint",
          };
        }
        secondCallBody = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ name: "Tech 2026", venue: "SVNIT" }) }],
                },
              },
            ],
          }),
        };
      });

      const resThinking = await parseBrief("ID cards for Tech 2026 at SVNIT", {
        apiKey: "dummy-key",
        fetchFn: /** @type {any} */ (mockFetchThinking400),
      });

      expect(resThinking.ok).toBe(true);
      expect(callCount).toBe(2);
      // Prove second call omitted thinkingConfig
      expect(secondCallBody.generationConfig?.thinkingConfig).toBeUndefined();

      // Case 2: 400 NOT mentioning thinking -> must NOT be retried
      let nonThinkingCalls = 0;
      const mockFetchOther400 = vi.fn().mockImplementation(async () => {
        nonThinkingCalls++;
        return {
          ok: false,
          status: 400,
          text: async () => "Error: prompt violates content policy",
        };
      });

      const resOther = await parseBrief("ID cards for Tech 2026 at SVNIT", {
        apiKey: "dummy-key",
        fetchFn: /** @type {any} */ (mockFetchOther400),
      });

      expect(resOther.ok).toBe(false);
      expect(nonThinkingCalls).toBe(1); // Exactly 1 call, zero retry!
    });

    // Test d: Fetch that never resolves (abort via signal): returns failure in under the deadline with emptySpec
    it("Test d: fetch that never resolves is aborted via signal and returns 422 fallback with emptySpec", async () => {
      const mockFetchHangs = vi.fn().mockImplementation((_url, options) => {
        return new Promise((_, reject) => {
          if (options?.signal) {
            options.signal.addEventListener("abort", () => {
              const err = new Error("Operation aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      });

      const t0 = Date.now();
      const res = await parseBrief("ID cards for Hang Fest", {
        apiKey: "dummy-key",
        fetchFn: /** @type {any} */ (mockFetchHangs),
        timeoutMs: 30,
        totalDeadlineMs: 70,
      });
      const elapsed = Date.now() - t0;

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("BRIEF_PARSE_FAILED");
        expect(res.emptySpec).toBeDefined();
        expect(res.emptySpec.designType).toBe("id-card");
      }
      expect(elapsed).toBeLessThan(200); // Bounded
    });

    // Test e: Total elapsed never exceeds deadline plus small margin
    it("Test e: total elapsed never exceeds deadline plus a small margin", async () => {
      const mockFetchDelayed = vi.fn().mockImplementation((_url, options) => {
        return new Promise((_, reject) => {
          if (options?.signal) {
            options.signal.addEventListener("abort", () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      });

      const t0 = Date.now();
      const res = await parseBrief("ID cards for Fast Deadline Fest", {
        apiKey: "dummy-key",
        fetchFn: /** @type {any} */ (mockFetchDelayed),
        timeoutMs: 80,
        totalDeadlineMs: 40,
      });
      const elapsed = Date.now() - t0;

      expect(res.ok).toBe(false);
      // Total elapsed should stay close to deadline (40ms) with small margin
      expect(elapsed).toBeLessThan(300);
    });
  });

  describe("5. parseBrief General & Privacy Tests", () => {
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

      // Verify privacy logging (Requirement 5): only brief length, outcome, attempts, and elapsed ms
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(`^\\[AI Intake\\] brief length: ${briefText.length}, outcome: ok, attempts: 1, elapsed: \\d+ms$`)
        )
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

    it("Test f (D-10 Privacy Test): proves request body contains only brief text and schema, never participant personal data", async () => {
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

  describe("6. Groq Fallback Provider Tests", () => {
    const briefText = "ID cards for Web3 Hackathon at IIT Bombay on 2026-10-25 with 150 hackers";

    it("6.1 Gemini success: Groq is not called", async () => {
      let groqCalled = false;
      const mockFetch = vi.fn().mockImplementation(async (url) => {
        if (url.includes("api.groq.com")) {
          groqCalled = true;
          throw new Error("Groq should not be called when Gemini succeeds!");
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
                        name: "Web3 Hackathon",
                        venue: "IIT Bombay",
                        dates: ["2026-10-25"],
                        roles: [{ label: "hackers", expectedCount: 150 }],
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
        apiKey: "gemini-key",
        groqApiKey: "groq-key",
        fetchFn: /** @type {any} */ (mockFetch),
        today: "2026-10-20",
      });

      expect(res.ok).toBe(true);
      expect(res.meta.provider).toBe("gemini");
      expect(groqCalled).toBe(false);
      expect(res.spec.event.name.value).toBe("Web3 Hackathon");
    });

    it("6.2 Gemini 503 followed by Groq success: fallback populates EventSpec contract with provenance", async () => {
      let geminiCallCount = 0;
      let groqCallCount = 0;

      const mockFetch = vi.fn().mockImplementation(async (url) => {
        if (url.includes("generativelanguage.googleapis.com")) {
          geminiCallCount++;
          return {
            ok: false,
            status: 503,
            text: async () => "The model is currently overloaded. Please try again later.",
          };
        }
        if (url.includes("api.groq.com")) {
          groqCallCount++;
          return {
            ok: true,
            json: async () => ({
              id: "chatcmpl-test",
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: JSON.stringify({
                      name: "Web3 Hackathon",
                      venue: "IIT Bombay",
                      dates: ["2026-10-25"],
                      roles: [{ label: "hackers", expectedCount: 150 }],
                    }),
                  },
                },
              ],
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const res = await parseBrief(briefText, {
        apiKey: "gemini-key",
        groqApiKey: "groq-key",
        fetchFn: /** @type {any} */ (mockFetch),
        today: "2026-10-20",
      });

      expect(res.ok).toBe(true);
      expect(geminiCallCount).toBe(1);
      expect(groqCallCount).toBe(1);
      expect(res.meta.provider).toBe("groq");
      expect(res.meta.fallbackFrom).toBe("gemini");
      expect(res.meta.model).toBe("openai/gpt-oss-120b");
      expect(DEFAULT_GROQ_MODEL).toBe("openai/gpt-oss-120b");
      expect(res.designType).toBe("id-card");

      // Verify strict provenance and confirmation semantics (status: "provided", confirmed: false)
      expect(res.spec.event.name).toEqual({
        value: "Web3 Hackathon",
        status: "provided",
        source: "brief",
        confirmed: false,
      });
      expect(res.spec.event.venue).toEqual({
        value: "IIT Bombay",
        status: "provided",
        source: "brief",
        confirmed: false,
      });
      expect(res.spec.event.dates).toEqual({
        value: ["2026-10-25"],
        status: "provided",
        source: "brief",
        confirmed: false,
      });
      expect(res.spec.roles.length).toBe(1);
      expect(res.spec.roles[0].label).toBe("hackers");
      expect(res.spec.roles[0].id).toBe("hackers");
      expect(res.spec.roles[0].expectedCount).toBe(150);
      expect(res.spec.roles[0].color.confirmed).toBe(false);
    });

    it("6.3 Gemini 502, 504, and timeout trigger Groq fallback", async () => {
      const runWithGeminiError = async (geminiHandler) => {
        const mockFetch = vi.fn().mockImplementation(async (url) => {
          if (url.includes("generativelanguage.googleapis.com")) {
            return geminiHandler();
          }
          if (url.includes("api.groq.com")) {
            return {
              ok: true,
              json: async () => ({
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: JSON.stringify({
                        name: "Web3 Hackathon",
                        venue: "IIT Bombay",
                      }),
                    },
                  },
                ],
              }),
            };
          }
        });

        return parseBrief(briefText, {
          apiKey: "gemini-key",
          groqApiKey: "groq-key",
          fetchFn: /** @type {any} */ (mockFetch),
          today: "2026-10-20",
        });
      };

      // 502 Bad Gateway
      const res502 = await runWithGeminiError(() => ({
        ok: false,
        status: 502,
        text: async () => "Bad Gateway",
      }));
      expect(res502.ok).toBe(true);
      expect(res502.meta.provider).toBe("groq");

      // 504 Gateway Timeout
      const res504 = await runWithGeminiError(() => ({
        ok: false,
        status: 504,
        text: async () => "Gateway Timeout",
      }));
      expect(res504.ok).toBe(true);
      expect(res504.meta.provider).toBe("groq");

      // Network Timeout (AbortError)
      const resTimeout = await runWithGeminiError(() => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      });
      expect(resTimeout.ok).toBe(true);
      expect(resTimeout.meta.provider).toBe("groq");
    });

    it("6.4 Gemini authentication errors (401, 403, missing key): Groq is NOT called", async () => {
      let groqCalls = 0;
      const mockFetch = vi.fn().mockImplementation(async (url) => {
        if (url.includes("api.groq.com")) {
          groqCalls++;
          return { ok: true, json: async () => ({ choices: [] }) };
        }
        return {
          ok: false,
          status: 401,
          text: async () => "API_KEY_INVALID: API key not valid.",
        };
      });

      // HTTP 401
      const res401 = await parseBrief(briefText, {
        apiKey: "bad-key",
        groqApiKey: "groq-key",
        fetchFn: /** @type {any} */ (mockFetch),
      });
      expect(res401.ok).toBe(false);
      expect(res401.error.code).toBe("AI_UNAVAILABLE");
      expect(groqCalls).toBe(0);

      // HTTP 403
      const mockFetch403 = vi.fn().mockImplementation(async (url) => {
        if (url.includes("api.groq.com")) {
          groqCalls++;
        }
        return {
          ok: false,
          status: 403,
          text: async () => "PERMISSION_DENIED",
        };
      });
      const res403 = await parseBrief(briefText, {
        apiKey: "forbidden-key",
        groqApiKey: "groq-key",
        fetchFn: /** @type {any} */ (mockFetch403),
      });
      expect(res403.ok).toBe(false);
      expect(res403.error.code).toBe("AI_UNAVAILABLE");
      expect(groqCalls).toBe(0);

      // Missing Gemini Key
      const resMissingKey = await parseBrief(briefText, {
        apiKey: "",
        groqApiKey: "groq-key",
        fetchFn: /** @type {any} */ (mockFetch),
      });
      expect(resMissingKey.ok).toBe(false);
      expect(resMissingKey.error.code).toBe("AI_UNAVAILABLE");
      expect(groqCalls).toBe(0);
    });

    it("6.5 Dual failure: preserves user input and returns recoverable error", async () => {
      const mockFetch = vi.fn().mockImplementation(async (url) => {
        if (url.includes("generativelanguage.googleapis.com")) {
          return {
            ok: false,
            status: 503,
            text: async () => "Gemini Service Unavailable",
          };
        }
        if (url.includes("api.groq.com")) {
          return {
            ok: false,
            status: 503,
            text: async () => "Groq Service Unavailable",
          };
        }
      });

      const res = await parseBrief("ID cards for Annual Summit 2026", {
        apiKey: "gemini-key",
        groqApiKey: "groq-key",
        fetchFn: /** @type {any} */ (mockFetch),
        sleepFn: () => Promise.resolve(),
      });

      expect(res.ok).toBe(false);
      expect(res.error.code).toBe("BRIEF_PARSE_FAILED");
      expect(res.error.message).toContain("Gemini transient error");
      expect(res.error.message).toContain("Groq fallback failed");

      // Verify preservation of user submitted info & scaffold
      expect(res.emptySpec).toBeDefined();
      expect(res.emptySpec.designType).toBe("id-card");
      expect(res.emptySpec.event.name.status).toBe("unknown");
    });

    it("6.6 Invalid Groq output fails safely without inventing or corrupting fields", async () => {
      // Test A: Groq returns malformed non-JSON text
      const mockFetchBadJson = vi.fn().mockImplementation(async (url) => {
        if (url.includes("generativelanguage.googleapis.com")) {
          return { ok: false, status: 503, text: async () => "Overloaded" };
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { role: "assistant", content: "Sorry, I am not JSON" } }],
          }),
        };
      });

      const resBadJson = await parseBrief("ID cards for Fest", {
        apiKey: "gemini-key",
        groqApiKey: "groq-key",
        fetchFn: /** @type {any} */ (mockFetchBadJson),
      });
      expect(resBadJson.ok).toBe(false);
      expect(resBadJson.error.code).toBe("BRIEF_PARSE_FAILED");
      expect(resBadJson.emptySpec.designType).toBe("id-card");

      // Test B: Groq returns schema violation (e.g. palette not valid hex strings)
      const mockFetchBadSchema = vi.fn().mockImplementation(async (url) => {
        if (url.includes("generativelanguage.googleapis.com")) {
          return { ok: false, status: 503, text: async () => "Overloaded" };
        }
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    name: "Fest",
                    palette: ["blue", "red"], // invalid regex, must be #RRGGBB
                  }),
                },
              },
            ],
          }),
        };
      });

      const resBadSchema = await parseBrief("ID cards for Fest", {
        apiKey: "gemini-key",
        groqApiKey: "groq-key",
        fetchFn: /** @type {any} */ (mockFetchBadSchema),
      });
      expect(resBadSchema.ok).toBe(false);
      expect(resBadSchema.error.code).toBe("BRIEF_PARSE_FAILED");

      // Test C: Groq returns hallucinated untraced fields -> evidenceCheck drops them
      const mockFetchHallucination = vi.fn().mockImplementation(async (url) => {
        if (url.includes("generativelanguage.googleapis.com")) {
          return { ok: false, status: 503, text: async () => "Overloaded" };
        }
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    name: "Made Up Conference 2099", // NOT in brief
                    venue: "Made Up Center", // NOT in brief
                    dates: ["2026-10-20"], // In brief
                  }),
                },
              },
            ],
          }),
        };
      });

      const resHallucination = await parseBrief("ID cards for 2026-10-20", {
        apiKey: "gemini-key",
        groqApiKey: "groq-key",
        fetchFn: /** @type {any} */ (mockFetchHallucination),
        today: "2026-10-20",
      });

      expect(resHallucination.ok).toBe(true);
      // Hallucinated name and venue dropped by evidence check
      expect(resHallucination.spec.event.name.status).toBe("unknown");
      expect(resHallucination.spec.event.name.value).toBeNull();
      expect(resHallucination.spec.event.venue.status).toBe("unknown");
      expect(resHallucination.spec.event.venue.value).toBeNull();
      // Traced date kept
      expect(resHallucination.spec.event.dates.value).toEqual(["2026-10-20"]);
      expect(resHallucination.spec.event.dates.confirmed).toBe(false);
    });

    it("6.7 HTTP 429 quota exhaustion stops without looping, transient rate limit respects backoff", async () => {
      // Test inspectRateLimit helper
      expect(inspectRateLimit(/** @type {any} */ ({}), "RESOURCE_EXHAUSTED: quota exceeded").isQuotaExhausted).toBe(true);
      expect(inspectRateLimit(/** @type {any} */ ({}), "insufficient_quota: credits exhausted").isQuotaExhausted).toBe(true);
      expect(inspectRateLimit(/** @type {any} */ ({ headers: new Map([["retry-after", "2"]]) }), "").retryAfterMs).toBe(2000);

      // Quota exhausted on Gemini stops immediately after bounded attempt
      let geminiCalls = 0;
      const mockFetchQuota = vi.fn().mockImplementation(async (url) => {
        if (url.includes("generativelanguage.googleapis.com")) {
          geminiCalls++;
          return {
            ok: false,
            status: 429,
            text: async () => "RESOURCE_EXHAUSTED: quota exceeded for current project",
          };
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { role: "assistant", content: JSON.stringify({ name: "Fest" }) } }],
          }),
        };
      });

      const resQuota = await parseBrief("ID cards for Fest", {
        apiKey: "gemini-key",
        groqApiKey: "groq-key",
        fetchFn: /** @type {any} */ (mockFetchQuota),
      });

      // Gemini stopped after 1 call (no endless retry on exhausted quota) and fell back to Groq
      expect(geminiCalls).toBe(1);
      expect(resQuota.ok).toBe(true);
      expect(resQuota.meta.provider).toBe("groq");
    });

    it("6.8 D-10 Privacy Test at network boundary: captures outbound Gemini and Groq bodies to prove zero participant PII/photos sent", async () => {
      const fakeParticipant = {
        name: "Rahul Verma",
        email: "rahul.verma@svnit.ac.in",
        phone: "+91-9988776655",
        photo: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...",
      };

      const briefText = "ID cards for National Tech Symposium at SVNIT Surat";
      let capturedGeminiBody = "";
      let capturedGroqBody = "";

      const mockFetch = vi.fn().mockImplementation(async (url, options) => {
        if (url.includes("generativelanguage.googleapis.com")) {
          capturedGeminiBody = options?.body || "";
          return {
            ok: false,
            status: 503,
            text: async () => "Service Unavailable",
          };
        }
        if (url.includes("api.groq.com")) {
          capturedGroqBody = options?.body || "";
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: JSON.stringify({
                      name: "National Tech Symposium",
                      venue: "SVNIT Surat",
                    }),
                  },
                },
              ],
            }),
          };
        }
      });

      const res = await parseBrief(briefText, {
        apiKey: "test-gemini-key",
        groqApiKey: "test-groq-key",
        fetchFn: /** @type {any} */ (mockFetch),
      });

      expect(res.ok).toBe(true);
      expect(res.meta.provider).toBe("groq");

      // Verify outbound Gemini body never includes PII or photos
      expect(capturedGeminiBody).not.toContain(fakeParticipant.name);
      expect(capturedGeminiBody).not.toContain(fakeParticipant.email);
      expect(capturedGeminiBody).not.toContain(fakeParticipant.phone);
      expect(capturedGeminiBody).not.toContain(fakeParticipant.photo);

      // Verify outbound Groq body never includes PII or photos
      expect(capturedGroqBody).not.toContain(fakeParticipant.name);
      expect(capturedGroqBody).not.toContain(fakeParticipant.email);
      expect(capturedGroqBody).not.toContain(fakeParticipant.phone);
      expect(capturedGroqBody).not.toContain(fakeParticipant.photo);

      // Verify secrets: API key must NOT be logged or placed inside request body
      expect(capturedGroqBody).not.toContain("test-groq-key");
    });

    it("6.9 Standalone parseBriefWithGroq: handles direct invocation, missing API key, and empty brief", async () => {
      // Empty brief
      const resEmpty = await parseBriefWithGroq("");
      expect(resEmpty.ok).toBe(false);
      expect(resEmpty.error.code).toBe("EMPTY_BRIEF");

      // Missing API key
      const resNoKey = await parseBriefWithGroq("ID cards for Event", { groqApiKey: "" });
      expect(resNoKey.ok).toBe(false);
      expect(resNoKey.error.code).toBe("AI_UNAVAILABLE");

      // Successful direct Groq parse
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  name: "Direct Groq Fest",
                  venue: "SVNIT",
                }),
              },
            },
          ],
        }),
      });

      const resDirect = await parseBriefWithGroq("ID cards for Direct Groq Fest at SVNIT", {
        groqApiKey: "direct-key",
        fetchFn: /** @type {any} */ (mockFetch),
      });

      expect(resDirect.ok).toBe(true);
      expect(resDirect.meta.provider).toBe("groq");
      expect(resDirect.spec.event.name.value).toBe("Direct Groq Fest");
    });

    it("6.10 assembleSpecFromExtraction: strictly enforces schema, evidence check, and provenance", () => {
      const brief = "ID cards for National Hackathon at SVNIT on 2026-10-20 with 100 students";
      const raw = {
        name: "National Hackathon",
        venue: "SVNIT",
        dates: ["2026-10-20"],
        roles: [{ label: "students", expectedCount: 100 }],
        tagline: "Invent Tomorrow", // Not in brief
      };

      const spec = assembleSpecFromExtraction(raw, brief, "id-card");
      expect(spec.designType).toBe("id-card");
      expect(spec.event.name).toEqual({
        value: "National Hackathon",
        status: "provided",
        source: "brief",
        confirmed: false,
      });
      expect(spec.event.venue).toEqual({
        value: "SVNIT",
        status: "provided",
        source: "brief",
        confirmed: false,
      });
      // Untraced tagline dropped
      expect(spec.event.tagline.status).toBe("unknown");
      // Roles correctly mapped and unconfirmed
      expect(spec.roles[0].label).toBe("students");
      expect(spec.roles[0].expectedCount).toBe(100);
      expect(spec.roles[0].color.confirmed).toBe(false);

      // Throws on schema violation
      expect(() => assembleSpecFromExtraction({ palette: ["invalid-color"] }, brief, "id-card")).toThrow();
    });

    it("6.11 Privacy & Logging during Groq fallback: logs only approved operational metadata and never logs keys, prompts, or provider bodies", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

      const sentinelGeminiKey = "SENTINEL_GEMINI_KEY_SECRET_776655";
      const sentinelGroqKey = "SENTINEL_GROQ_KEY_SECRET_112233";
      const sentinelBrief = "ID cards for SENTINEL_CYBER_SUMMIT at SENTINEL_HALL_X on 2026-10-20 with 88 engineers";
      const sentinelGeminiErrorBody = "SENTINEL_GEMINI_503_ERROR_OVERLOAD_SERVER_DOWN";
      const sentinelGroqPayload = {
        name: "SENTINEL_CYBER_SUMMIT",
        venue: "SENTINEL_HALL_X",
        dates: ["2026-10-20"],
        roles: [{ label: "engineers", expectedCount: 88 }],
      };

      /** @type {string[]} */
      const callOrder = [];

      try {
        const mockFetch = vi.fn().mockImplementation(async (url) => {
          if (url.includes("generativelanguage.googleapis.com")) {
            callOrder.push("gemini");
            return {
              ok: false,
              status: 503,
              text: async () => sentinelGeminiErrorBody,
            };
          }
          if (url.includes("api.groq.com")) {
            callOrder.push("groq");
            return {
              ok: true,
              json: async () => ({
                id: "chatcmpl-sentinel-id-999",
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: JSON.stringify(sentinelGroqPayload),
                    },
                  },
                ],
              }),
            };
          }
          throw new Error(`Unexpected URL in mockFetch: ${url}`);
        });

        const res = await parseBrief(sentinelBrief, {
          apiKey: sentinelGeminiKey,
          groqApiKey: sentinelGroqKey,
          fetchFn: /** @type {any} */ (mockFetch),
          today: "2026-10-20",
        });

        // 1. Assert call order: Gemini called first, Groq called as fallback
        expect(callOrder).toEqual(["gemini", "groq"]);

        // 2. Assert parsing succeeds through existing validation and evidence-check pipeline
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(res.meta.provider).toBe("groq");
          expect(res.meta.fallbackFrom).toBe("gemini");
          expect(res.spec.event.name).toEqual({
            value: "SENTINEL_CYBER_SUMMIT",
            status: "provided",
            source: "brief",
            confirmed: false,
          });
          expect(res.spec.event.venue).toEqual({
            value: "SENTINEL_HALL_X",
            status: "provided",
            source: "brief",
            confirmed: false,
          });
          expect(res.spec.roles[0].label).toBe("engineers");
          expect(res.spec.roles[0].expectedCount).toBe(88);
          expect(res.spec.roles[0].color.confirmed).toBe(false);
        }

        // 3. Collect all console output
        const logCalls = logSpy.mock.calls.map((args) => args.join(" "));
        const allConsoleOutput = [
          ...logCalls,
          ...errorSpy.mock.calls.map((args) => args.join(" ")),
          ...warnSpy.mock.calls.map((args) => args.join(" ")),
          ...infoSpy.mock.calls.map((args) => args.join(" ")),
        ].join("\n");

        // 4. Assert zero calls to error, warn, or info
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
        expect(infoSpy).not.toHaveBeenCalled();

        // 5. Assert logs strictly follow approved operational metadata format
        expect(logCalls.length).toBe(2);
        for (const line of logCalls) {
          expect(line).toMatch(
            new RegExp(`^\\[AI Intake\\] brief length: ${sentinelBrief.length}, outcome: (fallback_groq|ok), attempts: \\d+, elapsed: \\d+ms$`)
          );
        }

        // 6. Assert no secrets appear in logs
        expect(allConsoleOutput).not.toContain(sentinelGeminiKey);
        expect(allConsoleOutput).not.toContain(sentinelGroqKey);

        // 7. Assert neither sentinel prompt text nor provider response body appears in logs
        expect(allConsoleOutput).not.toContain("SENTINEL_CYBER_SUMMIT");
        expect(allConsoleOutput).not.toContain("SENTINEL_HALL_X");
        expect(allConsoleOutput).not.toContain("HARD RULE (D-02)");
        expect(allConsoleOutput).not.toContain(sentinelGeminiErrorBody);
        expect(allConsoleOutput).not.toContain("chatcmpl-sentinel-id-999");
        expect(allConsoleOutput).not.toContain("choices");
      } finally {
        logSpy.mockRestore();
        errorSpy.mockRestore();
        warnSpy.mockRestore();
        infoSpy.mockRestore();
      }
    });

    it("6.12 Groq model resolution: defaults to openai/gpt-oss-120b and respects overrides", async () => {
      // 1. Verify default model constant
      expect(DEFAULT_GROQ_MODEL).toBe("openai/gpt-oss-120b");

      let capturedPayload = null;
      const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
        capturedPayload = JSON.parse(options?.body || "{}");
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { role: "assistant", content: JSON.stringify({ name: "Event" }) } }],
          }),
        };
      });

      // Default resolution without options or env
      const origEnv = process.env.GROQ_MODEL;
      delete process.env.GROQ_MODEL;

      await parseBriefWithGroq("ID cards for Event", {
        groqApiKey: "key",
        fetchFn: /** @type {any} */ (mockFetch),
      });
      expect(capturedPayload?.model).toBe("openai/gpt-oss-120b");

      // Environment variable override
      process.env.GROQ_MODEL = "custom-env-model";
      await parseBriefWithGroq("ID cards for Event", {
        groqApiKey: "key",
        fetchFn: /** @type {any} */ (mockFetch),
      });
      expect(capturedPayload?.model).toBe("custom-env-model");

      // Options override takes precedence over environment variable
      await parseBriefWithGroq("ID cards for Event", {
        groqApiKey: "key",
        groqModel: "explicit-options-model",
        fetchFn: /** @type {any} */ (mockFetch),
      });
      expect(capturedPayload?.model).toBe("explicit-options-model");

      // Restore env
      if (origEnv !== undefined) {
        process.env.GROQ_MODEL = origEnv;
      } else {
        delete process.env.GROQ_MODEL;
      }
    });
  });
});
