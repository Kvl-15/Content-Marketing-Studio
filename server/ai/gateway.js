// @ts-check
/**
 * @module server/ai/gateway
 * Gemini REST gateway for brief parsing with structured JSON mode (KB 7.1, 7.7).
 * Pure plain fetch (Node 24 native), no SDK, strict zero-inventory (D-02),
 * and personal data privacy (D-10).
 */

import { z } from "zod";
import { emptySpec } from "../intake/emptySpec.js";
import { isValidCalendarDate } from "../intake/gaps.js";
import { slugify, defaultRoleColor } from "../intake/applyAnswer.js";

/**
 * Default Groq fallback model.
 * Verified available in Groq production model documentation (console.groq.com/docs/models).
 */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/**
 * Zod schema for structured brief extraction from Gemini.
 */
export const BriefExtractionSchema = z.object({
  name: z.string().nullable().optional(),
  tagline: z.string().nullable().optional(),
  venue: z.string().nullable().optional(),
  dates: z.array(z.string()).nullable().optional(),
  roles: z
    .array(
      z.object({
        label: z.string(),
        expectedCount: z.number().int().min(0).optional(),
      })
    )
    .nullable()
    .optional(),
  fields: z.array(z.string()).nullable().optional(),
  palette: z
    .array(z.string().regex(/^#[0-9A-Fa-f]{6}$/))
    .max(3)
    .nullable()
    .optional(),
});

/**
 * Detects designType from keywords per addendum:
 * "ID cards" gives id-card. An unknown type is NOT guessed: leave it unset.
 *
 * @param {string} text
 * @returns {"id-card" | null}
 */
export function detectDesignType(text) {
  if (typeof text !== "string") return null;
  if (/\b(id[- ]cards?|identity cards?|badges?)\b/i.test(text)) {
    return "id-card";
  }
  return null;
}

/**
 * Allowed thinking levels for Gemini thinking models.
 */
const ALLOWED_THINKING_LEVELS = new Set(["minimal", "low", "medium", "high"]);

/**
 * Resolves the thinking level configuration.
 * - undefined / null -> default "low"
 * - "" (empty string) -> null (omit thinkingConfig completely)
 * - "minimal" | "low" | "medium" | "high" -> normalized level
 * - invalid value -> fallback to "low" with one privacy-safe log line
 *
 * @param {string | undefined | null} rawInput
 * @returns {string | null}
 */
export function resolveThinkingLevel(rawInput) {
  if (rawInput === undefined || rawInput === null) {
    return "low";
  }
  if (typeof rawInput === "string" && rawInput.trim() === "") {
    return null;
  }
  const normalized = typeof rawInput === "string" ? rawInput.trim().toLowerCase() : "";
  if (ALLOWED_THINKING_LEVELS.has(normalized)) {
    return normalized;
  }
  console.log("[AI Intake] Invalid GEMINI_THINKING_LEVEL, falling back to low");
  return "low";
}

/**
 * Checks if a string or number can be traced in the original brief text.
 * Requires word-boundary match for words and numbers to avoid false positives.
 *
 * @param {string | number | null | undefined} value
 * @param {string} text
 * @returns {boolean}
 */
export function isTracedInText(value, text) {
  if (value === null || value === undefined) return false;
  const rawValue = String(value).trim();
  if (!rawValue) return false;

  const lowerText = text.toLowerCase();
  const lowerValue = rawValue.toLowerCase();

  // Direct exact substring check
  if (lowerText.includes(lowerValue)) return true;

  // Tokenise by non-alphanumeric, filtering out common words
  const tokens = lowerValue
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 2 && !/^(the|and|for|with|from|that|this|are|was|were)$/i.test(t));

  if (tokens.length === 0) return false;

  // For general strings, check if tokens exist with word boundaries
  return tokens.some((token) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  });
}

/**
 * Traces whether a specific calendar date (YYYY-MM-DD) is mentioned in brief.
 * Requires either the full date string or the specific day number in the text.
 *
 * @param {string} dateStr
 * @param {string} brief
 * @returns {boolean}
 */
export function isDateTraced(dateStr, brief) {
  if (!isValidCalendarDate(dateStr)) return false;
  if (brief.includes(dateStr)) return true;

  const [year, month, day] = dateStr.split("-");
  const dayNum = parseInt(day, 10);
  const dayPattern = new RegExp(`\\b${dayNum}(st|nd|rd|th)?\\b|\\b${day}\\b`, "i");

  // The day must appear in the text
  if (!dayPattern.test(brief)) return false;

  // And the year or month must also be present
  const monthNum = parseInt(month, 10);
  const monthNames = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec"
  ];
  const monthName = monthNames[monthNum - 1];
  const monthPattern = new RegExp(`\\b${month}\\b|\\b${monthName}`, "i");
  const yearPattern = new RegExp(`\\b${year}\\b`);

  return monthPattern.test(brief) || yearPattern.test(brief);
}

/**
 * Verifies and filters extracted fields against the brief text (KB 7.1 step 4).
 * Values that cannot be traced are discarded (set to null/unknown).
 *
 * @param {import("zod").infer<typeof BriefExtractionSchema>} raw
 * @param {string} brief
 * @returns {any}
 */
export function evidenceCheck(raw, brief) {
  const result = {
    name: isTracedInText(raw.name, brief) ? raw.name?.trim() || null : null,
    tagline: isTracedInText(raw.tagline, brief) ? raw.tagline?.trim() || null : null,
    venue: isTracedInText(raw.venue, brief) ? raw.venue?.trim() || null : null,
    dates: null,
    roles: null,
    fields: null,
    palette: null,
  };

  // Trace dates
  if (Array.isArray(raw.dates)) {
    const validTracedDates = raw.dates.filter((d) => isDateTraced(d, brief));
    if (validTracedDates.length > 0) {
      result.dates = validTracedDates;
    }
  }

  // Trace roles
  if (Array.isArray(raw.roles)) {
    const validRoles = [];
    for (const r of raw.roles) {
      if (r && typeof r.label === "string" && isTracedInText(r.label, brief)) {
        const expectedCount =
          typeof r.expectedCount === "number" && isTracedInText(r.expectedCount, brief)
            ? r.expectedCount
            : 0;
        validRoles.push({
          label: r.label.trim(),
          expectedCount,
        });
      }
    }
    if (validRoles.length > 0) {
      result.roles = validRoles;
    }
  }

  // Trace fields
  if (Array.isArray(raw.fields)) {
    const validFields = raw.fields.filter((f) => typeof f === "string" && isTracedInText(f, brief));
    if (validFields.length > 0) {
      result.fields = validFields;
    }
  }

  // Trace palette
  if (Array.isArray(raw.palette)) {
    const validPalette = raw.palette.filter((c) => isTracedInText(c, brief));
    if (validPalette.length > 0) {
      result.palette = validPalette;
    }
  }

  return result;
}

/**
 * Validates extraction output against BriefExtractionSchema and evidenceCheck,
 * then maps the verified fields into an EventSpec scaffold with provenance.
 * Strictly preserves confirmation semantics (status: "provided", confirmed: false).
 * Never invents missing event details.
 *
 * @param {any} rawExtraction
 * @param {string} brief
 * @param {"id-card" | null} detectedType
 * @returns {any}
 */
export function assembleSpecFromExtraction(rawExtraction, brief, detectedType) {
  const validated = BriefExtractionSchema.parse(rawExtraction);
  const verified = evidenceCheck(validated, brief);
  const assembledSpec = emptySpec(detectedType);

  if (verified.name) {
    assembledSpec.event.name = {
      value: verified.name,
      status: "provided",
      source: "brief",
      confirmed: false,
    };
  }
  if (verified.tagline) {
    assembledSpec.event.tagline = {
      value: verified.tagline,
      status: "provided",
      source: "brief",
      confirmed: false,
    };
  }
  if (verified.venue) {
    assembledSpec.event.venue = {
      value: verified.venue,
      status: "provided",
      source: "brief",
      confirmed: false,
    };
  }
  if (verified.dates) {
    assembledSpec.event.dates = {
      value: verified.dates,
      status: "provided",
      source: "brief",
      confirmed: false,
    };
  }
  if (verified.palette) {
    assembledSpec.event.palette = verified.palette;
  }
  if (verified.fields) {
    assembledSpec.fields = {
      value: verified.fields,
      status: "provided",
      source: "brief",
      confirmed: false,
    };
  }
  if (verified.roles && verified.roles.length > 0) {
    assembledSpec.roles = verified.roles.map((r, i) => ({
      id: slugify(r.label),
      label: r.label,
      expectedCount: r.expectedCount || 0,
      color: {
        value: defaultRoleColor(i),
        status: "defaulted",
        source: "default",
        confirmed: false,
      },
    }));
  }

  return assembledSpec;
}

/**
 * Inspects HTTP 429 response for Retry-After header or quota exhaustion.
 *
 * @param {Response} response
 * @param {string} errorText
 * @returns {{ isQuotaExhausted: boolean; retryAfterMs: number | null }}
 */
export function inspectRateLimit(response, errorText = "") {
  const isQuotaExhausted = /quota|insufficient_quota|billing|credit|resource_exhausted/i.test(errorText);

  let retryAfterMs = null;
  const retryAfterHeader = response?.headers?.get ? response.headers.get("retry-after") : null;
  if (retryAfterHeader) {
    const seconds = parseFloat(retryAfterHeader);
    if (!isNaN(seconds) && seconds > 0) {
      retryAfterMs = Math.round(seconds * 1000);
    }
  }

  return { isQuotaExhausted, retryAfterMs };
}

/**
 * Default sleep implementation.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parses a brief using Groq chat completions REST API with structured JSON output.
 * Acts as the fallback provider when Gemini experiences transient outages.
 *
 * @param {string} briefText
 * @param {{
 *   today?: string;
 *   fetchFn?: typeof fetch;
 *   groqApiKey?: string;
 *   groqModel?: string;
 *   timeoutMs?: number;
 *   totalDeadlineMs?: number;
 *   sleepFn?: (ms: number) => Promise<void>;
 * }} [options]
 * @returns {Promise<{
 *   ok: true;
 *   spec: any;
 *   designType: string | null;
 *   meta: {
 *     provider: "groq";
 *     model: string;
 *     attempts: number;
 *     elapsedMs: number;
 *     outcome: string;
 *   };
 * } | {
 *   ok: false;
 *   error: { code: string; message: string; details?: any };
 *   emptySpec: any;
 *   meta: {
 *     provider: "groq";
 *     model: string;
 *     attempts: number;
 *     elapsedMs: number;
 *     outcome: string;
 *   };
 * }>}
 */
export async function parseBriefWithGroq(briefText, options = {}) {
  const startTime = Date.now();
  const brief = typeof briefText === "string" ? briefText.trim() : "";
  const detectedType = detectDesignType(brief);
  const fallbackSpec = emptySpec(detectedType);

  const model = options.groqModel || process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  const apiKey = options.groqApiKey || process.env.GROQ_API_KEY;
  const today = options.today || "2026-10-20";
  const fetchFn = options.fetchFn || globalThis.fetch;
  const sleepFn = options.sleepFn || defaultSleep;

  const totalDeadlineMs = options.totalDeadlineMs ?? 35000;
  const perAttemptTimeout = options.timeoutMs ?? 15000;

  if (!brief) {
    return {
      ok: false,
      error: { code: "EMPTY_BRIEF", message: "Brief text is required." },
      emptySpec: fallbackSpec,
      meta: {
        provider: "groq",
        model,
        attempts: 0,
        elapsedMs: Date.now() - startTime,
        outcome: "failed",
      },
    };
  }

  if (!apiKey) {
    const elapsedMs = Date.now() - startTime;
    return {
      ok: false,
      error: {
        code: "AI_UNAVAILABLE",
        message: "Groq API key is not configured.",
      },
      emptySpec: fallbackSpec,
      meta: {
        provider: "groq",
        model,
        attempts: 0,
        elapsedMs,
        outcome: "failed",
      },
    };
  }

  const endpointUrl = "https://api.groq.com/openai/v1/chat/completions";
  let attempts = 0;
  let lastError = null;

  while (attempts < 2) {
    const elapsedNow = Date.now() - startTime;
    const timeLeft = totalDeadlineMs - elapsedNow;
    if (timeLeft <= 0) {
      lastError = new Error("Deadline exceeded");
      break;
    }

    const attemptTimeout = Math.max(1, Math.min(perAttemptTimeout, timeLeft));
    attempts++;

    const prompt = buildPrompt(brief, today, lastError?.message);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), attemptTimeout);

      const response = await fetchFn(endpointUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");

        if (response.status === 401 || response.status === 403) {
          throw new Error(`Groq authentication error (HTTP ${response.status}): ${errorText.slice(0, 200)}`);
        }

        if (response.status === 429) {
          const { isQuotaExhausted, retryAfterMs } = inspectRateLimit(response, errorText);
          if (isQuotaExhausted || attempts >= 2) {
            throw new Error(`Groq rate limit exceeded (HTTP 429): ${errorText.slice(0, 200)}`);
          }
          const waitTime = Math.min(retryAfterMs ?? 500, 2000);
          await sleepFn(waitTime);
          continue;
        }

        if ([500, 502, 503, 504].includes(response.status)) {
          if (attempts < 2) {
            await sleepFn(500);
            continue;
          }
        }

        throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty content in Groq response choices");
      }

      const parsedJson = JSON.parse(content);
      const assembledSpec = assembleSpecFromExtraction(parsedJson, brief, detectedType);

      const elapsedMs = Date.now() - startTime;
      return {
        ok: true,
        spec: assembledSpec,
        designType: detectedType,
        meta: {
          provider: "groq",
          model,
          attempts,
          elapsedMs,
          outcome: attempts === 1 ? "ok" : "retry",
        },
      };
    } catch (err) {
      lastError = err;
      if (err.message?.includes("authentication error")) {
        break;
      }
    }
  }

  const elapsedMs = Date.now() - startTime;
  return {
    ok: false,
    error: {
      code: "BRIEF_PARSE_FAILED",
      message: `Failed to parse brief with Groq: ${lastError?.message || "Unknown error"}`,
    },
    emptySpec: fallbackSpec,
    meta: {
      provider: "groq",
      model,
      attempts,
      elapsedMs,
      outcome: "failed",
    },
  };
}

/**
 * Builds the prompt string containing JSON schema, today's date, brief,
 * and the hard zero-invention rule.
 *
 * @param {string} brief
 * @param {string} todayDate
 * @param {string} [retryError]
 * @returns {string}
 */
export function buildPrompt(brief, todayDate, retryError) {
  const schemaDescription = `
{
  "name": string or null (event name),
  "tagline": string or null (event tagline/subtitle),
  "venue": string or null (location or venue),
  "dates": array of string or null (dates in "YYYY-MM-DD" format),
  "roles": array of objects with {"label": string, "expectedCount": number} or null,
  "fields": array of string or null (participant fields mentioned, e.g. ["name", "role", "org", "photo"]),
  "palette": array of 1-3 hex color strings or null
}`;

  return `You are an information extraction assistant for an event badging studio.
Today's date is: ${todayDate}

HARD RULE (D-02): Extract ONLY information that is explicitly stated in the brief text below.
If a detail is not explicitly mentioned, use null.
NEVER invent, assume, extrapolate, or guess any dates, venues, names, numbers, or colors.
The actual participant people come from a CSV upload later; never invent individual participant names or people.

Return a JSON object conforming strictly to this shape:
${schemaDescription}
${retryError ? `\nIMPORTANT: Your previous attempt failed validation with: ${retryError}. Fix this and return valid JSON matching the schema strictly.` : ""}

Brief text:
${brief}`;
}

/**
 * Parses a brief using Gemini REST API with Node native fetch.
 *
 * @param {string} briefText
 * @param {{
 *   today?: string;
 *   fetchFn?: typeof fetch;
 *   model?: string;
 *   apiKey?: string;
 *   timeoutMs?: number;
 *   totalDeadlineMs?: number;
 *   thinkingLevel?: string | null;
 * }} [options]
 * @returns {Promise<{
 *   ok: true;
 *   spec: any;
 *   designType: string | null;
 *   meta: {
 *     model: string;
 *     thinkingLevel: string | null;
 *     attempts: number;
 *     elapsedMs: number;
 *     outcome: string;
 *   };
 * } | {
 *   ok: false;
 *   error: { code: string; message: string; details?: any };
 *   emptySpec: any;
 *   meta: {
 *     model: string;
 *     thinkingLevel: string | null;
 *     attempts: number;
 *     elapsedMs: number;
 *     outcome: string;
 *   };
 * }>}
 */
export async function parseBrief(briefText, options = {}) {
  const startTime = Date.now();
  const brief = typeof briefText === "string" ? briefText.trim() : "";
  const detectedType = detectDesignType(brief);
  const fallbackSpec = emptySpec(detectedType);

  const model = options.model || process.env.GEMINI_MODEL || "gemini-3-flash-preview";
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  const groqApiKey = options.groqApiKey || process.env.GROQ_API_KEY;
  const today = options.today || "2026-10-20";
  const fetchFn = options.fetchFn || globalThis.fetch;
  const sleepFn = options.sleepFn || defaultSleep;

  // Time limits (Requirement 4): default 35s overall deadline, 15s per-attempt timeout
  const totalDeadlineMs = options.totalDeadlineMs ?? 35000;
  const perAttemptTimeout = options.timeoutMs ?? 15000;

  // Thinking level resolution (Requirement 2)
  const envOrOptThinking =
    options.thinkingLevel !== undefined
      ? options.thinkingLevel
      : process.env.GEMINI_THINKING_LEVEL;
  const initialThinkingLevel = resolveThinkingLevel(envOrOptThinking);
  let currentThinkingLevel = initialThinkingLevel;
  let thinkingFallbackUsed = false;

  if (!brief) {
    return {
      ok: false,
      error: { code: "EMPTY_BRIEF", message: "Brief text is required." },
      emptySpec: fallbackSpec,
      meta: {
        provider: "gemini",
        model,
        thinkingLevel: initialThinkingLevel,
        attempts: 0,
        elapsedMs: Date.now() - startTime,
        outcome: "failed",
      },
    };
  }

  if (!apiKey) {
    // KB 7.7 logging: log only brief length, outcome, attempts, and elapsed ms
    const elapsedMs = Date.now() - startTime;
    console.log(`[AI Intake] brief length: ${brief.length}, outcome: failed (missing API key), attempts: 0, elapsed: ${elapsedMs}ms`);
    return {
      ok: false,
      error: {
        code: "AI_UNAVAILABLE",
        message: "Gemini API key is not configured (form fallback).",
      },
      emptySpec: fallbackSpec,
      meta: {
        provider: "gemini",
        model,
        thinkingLevel: initialThinkingLevel,
        attempts: 0,
        elapsedMs,
        outcome: "failed",
      },
    };
  }

  const endpointUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let normalAttempts = 0;
  let totalAttempts = 0;
  let lastError = null;
  let isThinkingRetry = false;
  let isAuthError = false;
  let isTransient = false;

  while (normalAttempts < 2) {
    const elapsedNow = Date.now() - startTime;
    const timeLeft = totalDeadlineMs - elapsedNow;
    if (timeLeft <= 0) {
      lastError = new Error("Deadline of 35000ms exceeded");
      isTransient = true;
      break;
    }

    const attemptTimeout = Math.max(1, Math.min(perAttemptTimeout, timeLeft));
    totalAttempts++;

    if (!isThinkingRetry) {
      normalAttempts++;
    }
    isThinkingRetry = false;

    const prompt = buildPrompt(brief, today, lastError?.message);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), attemptTimeout);

      const generationConfig = {
        responseMimeType: "application/json",
        ...(currentThinkingLevel
          ? { thinkingConfig: { thinkingLevel: currentThinkingLevel } }
          : {}),
      };

      const response = await fetchFn(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");

        // Authentication errors (401, 403) - do NOT retry, do NOT call Groq
        if (response.status === 401 || response.status === 403) {
          isAuthError = true;
          lastError = new Error(`HTTP ${response.status} (authentication error): ${errorText.slice(0, 200)}`);
          break;
        }

        // Requirement 3: Thinking fallback on HTTP 400 mentioning "thinking"
        if (response.status === 400) {
          if (!thinkingFallbackUsed && /thinking/i.test(errorText)) {
            thinkingFallbackUsed = true;
            currentThinkingLevel = null; // retry without thinkingConfig
            isThinkingRetry = true; // does not count as a normal attempt
            lastError = new Error(`HTTP 400 (thinking fallback): ${errorText.slice(0, 200)}`);
            continue;
          }
          // Do not retry other 400s
          lastError = new Error(`HTTP 400: ${errorText.slice(0, 200)}`);
          break;
        }

        // HTTP 429: inspect rate limit / quota exhaustion
        if (response.status === 429) {
          const { isQuotaExhausted, retryAfterMs } = inspectRateLimit(response, errorText);
          isTransient = true;
          lastError = new Error(`HTTP 429 (rate limit): ${errorText.slice(0, 200)}`);
          if (isQuotaExhausted || normalAttempts >= 2) {
            break; // Stop immediately without looping on quota exhaustion
          }
          const waitMs = Math.min(retryAfterMs ?? 500, 2000);
          const timeAvailable = totalDeadlineMs - (Date.now() - startTime);
          if (timeAvailable > waitMs) {
            await sleepFn(waitMs);
            continue;
          }
          break;
        }

        // Transient provider errors: HTTP 502, 503, 504
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          isTransient = true;
          lastError = new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
          if (groqApiKey) {
            break; // Fall back to Groq immediately
          }
          if (normalAttempts < 2) {
            await sleepFn(500);
            continue;
          }
          break;
        }

        // Transient 500
        if (response.status === 500) {
          isTransient = true;
          lastError = new Error(`HTTP 500: ${errorText.slice(0, 200)}`);
          if (normalAttempts < 2) {
            continue;
          }
          break;
        }

        throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const data = await response.json();
      const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textContent) {
        throw new Error("Empty candidate text in Gemini response");
      }

      const parsedJson = JSON.parse(textContent);
      const assembledSpec = assembleSpecFromExtraction(parsedJson, brief, detectedType);

      const elapsedMs = Date.now() - startTime;
      const outcome = totalAttempts === 1 ? "ok" : "retry";
      console.log(`[AI Intake] brief length: ${brief.length}, outcome: ${outcome}, attempts: ${totalAttempts}, elapsed: ${elapsedMs}ms`);

      return {
        ok: true,
        spec: assembledSpec,
        designType: detectedType,
        meta: {
          provider: "gemini",
          model,
          thinkingLevel: initialThinkingLevel,
          attempts: totalAttempts,
          elapsedMs,
          outcome,
        },
      };
    } catch (err) {
      lastError = err;
      if (err.name === "AbortError" || /aborted|timeout|fetch failed/i.test(err.message)) {
        isTransient = true;
        if (groqApiKey) {
          break; // Fall back to Groq immediately on timeout
        }
      }
      if (normalAttempts < 2 && !isAuthError) {
        const elapsedSoFar = Date.now() - startTime;
        console.log(`[AI Intake] brief length: ${brief.length}, outcome: retry, attempts: ${totalAttempts}, elapsed: ${elapsedSoFar}ms`);
      }
    }
  }

  // Handle Authentication Errors (401/403) - Groq is NOT called
  if (isAuthError) {
    const elapsedMs = Date.now() - startTime;
    console.log(`[AI Intake] brief length: ${brief.length}, outcome: failed (auth error), attempts: ${totalAttempts}, elapsed: ${elapsedMs}ms`);
    return {
      ok: false,
      error: {
        code: "AI_UNAVAILABLE",
        message: `Gemini authentication error: ${lastError?.message || "Invalid or unauthorized API key"}`,
      },
      emptySpec: fallbackSpec,
      meta: {
        provider: "gemini",
        model,
        thinkingLevel: initialThinkingLevel,
        attempts: totalAttempts,
        elapsedMs,
        outcome: "failed",
      },
    };
  }

  // Handle Transient Provider Error -> Fall back to Groq if configured
  if (isTransient && groqApiKey) {
    const remainingTime = totalDeadlineMs - (Date.now() - startTime);
    if (remainingTime > 100) {
      console.log(`[AI Intake] brief length: ${brief.length}, outcome: fallback_groq, attempts: ${totalAttempts}, elapsed: ${Date.now() - startTime}ms`);
      const groqResult = await parseBriefWithGroq(brief, {
        ...options,
        groqApiKey,
        fetchFn: options.groqFetchFn || options.fetchFn,
        totalDeadlineMs: remainingTime,
        timeoutMs: Math.min(perAttemptTimeout, remainingTime),
        sleepFn,
      });

      if (groqResult.ok) {
        const totalElapsed = Date.now() - startTime;
        console.log(`[AI Intake] brief length: ${brief.length}, outcome: ok, attempts: ${totalAttempts + groqResult.meta.attempts}, elapsed: ${totalElapsed}ms`);
        return {
          ok: true,
          spec: groqResult.spec,
          designType: detectedType,
          meta: {
            ...groqResult.meta,
            fallbackFrom: "gemini",
            geminiAttempts: totalAttempts,
            totalElapsedMs: totalElapsed,
          },
        };
      }

      // Both providers failed: preserve user input scaffold, return clear recoverable error
      const totalElapsed = Date.now() - startTime;
      console.log(`[AI Intake] brief length: ${brief.length}, outcome: failed, attempts: ${totalAttempts + (groqResult.meta?.attempts || 0)}, elapsed: ${totalElapsed}ms`);
      return {
        ok: false,
        error: {
          code: "BRIEF_PARSE_FAILED",
          message: `Gemini transient error (${lastError?.message || "transient error"}) and Groq fallback failed (${groqResult.error?.message || "fallback failed"})`,
        },
        emptySpec: fallbackSpec,
        meta: {
          provider: "fallback_failed",
          model,
          thinkingLevel: initialThinkingLevel,
          attempts: totalAttempts + (groqResult.meta?.attempts || 0),
          elapsedMs: totalElapsed,
          outcome: "failed",
        },
      };
    }
  }

  // On failure, log and return empty spec alongside error (KB 7.1 step 3)
  const elapsedMs = Date.now() - startTime;
  console.log(`[AI Intake] brief length: ${brief.length}, outcome: failed, attempts: ${totalAttempts}, elapsed: ${elapsedMs}ms`);
  return {
    ok: false,
    error: {
      code: "BRIEF_PARSE_FAILED",
      message: `Failed to parse brief after retry: ${lastError?.message || "Unknown error"}`,
    },
    emptySpec: fallbackSpec,
    meta: {
      provider: "gemini",
      model,
      thinkingLevel: initialThinkingLevel,
      attempts: totalAttempts,
      elapsedMs,
      outcome: "failed",
    },
  };
}
