// @ts-check
/**
 * @module client/src/api
 * Plain fetch API client for Content Marketing Studio REST endpoints.
 * Target: import.meta.env.VITE_API_URL || "http://localhost:3000"
 */

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

/**
 * Standard typed API error representing { error: { code, message, issues? } }
 */
export class ApiError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {any[]} [issues]
   */
  constructor(code, message, issues = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.issues = issues;
  }
}

/**
 * Helper to execute JSON requests with clean error extraction.
 *
 * @param {string} path
 * @param {any} body
 * @returns {Promise<any>}
 */
async function postJson(path, body) {
  const url = `${BASE_URL}${path}`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      "NETWORK_ERROR",
      `Unable to connect to server at ${BASE_URL}. Ensure the backend is running.`
    );
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new ApiError(
      "INVALID_RESPONSE",
      `Received non-JSON response from server (HTTP ${response.status}).`
    );
  }

  return { ok: response.ok, status: response.status, data: json };
}

/**
 * Step 1: Parse a brief into an EventSpec scaffold.
 * Handles HTTP 422 fallback (BRIEF_PARSE_FAILED / AI_UNAVAILABLE) gracefully
 * by returning { ok: false, error, emptySpec } so the UI can open the manual form directly.
 *
 * @param {string} brief
 * @returns {Promise<{
 *   ok: boolean;
 *   spec: any;
 *   designType?: string | null;
 *   error?: { code: string; message: string; issues?: any[] };
 *   emptySpec?: any;
 * }>}
 */
export async function parseBrief(brief) {
  const { ok, status, data } = await postJson("/intake/parse", { brief });

  if (ok && data?.status === "ok") {
    return {
      ok: true,
      spec: data.spec,
      designType: data.designType,
    };
  }

  // 422 returns emptySpec alongside error for instant form fallback (KB 7.1 step 3)
  if (status === 422 && data?.emptySpec) {
    return {
      ok: false,
      error: data.error || { code: "BRIEF_PARSE_FAILED", message: "Brief parsing failed." },
      emptySpec: data.emptySpec,
      spec: data.emptySpec,
    };
  }

  // Fatal error
  const err = data?.error || { code: "PARSE_ERROR", message: "Failed to parse brief." };
  throw new ApiError(err.code, err.message, err.issues);
}

/**
 * Step 2a: Request next questions and gap analysis.
 *
 * @param {any} spec
 * @param {string[]} [declined]
 * @returns {Promise<{
 *   questions: any[];
 *   currentStep: number;
 *   totalSteps: number;
 *   allDone: boolean;
 *   gaps: {
 *     required: any[];
 *     defaulted: any[];
 *     optional: any[];
 *     derived: any[];
 *   };
 *   hasRequiredGaps: boolean;
 * }>}
 */
export async function getQuestions(spec, declined = []) {
  const { ok, data } = await postJson("/intake/questions", { spec, declined });

  if (!ok || data?.status !== "ok") {
    const err = data?.error || { code: "QUESTIONS_ERROR", message: "Failed to fetch questions." };
    throw new ApiError(err.code, err.message, err.issues);
  }

  return {
    questions: data.questions || [],
    currentStep: data.currentStep || 1,
    totalSteps: data.totalSteps || 3,
    allDone: Boolean(data.allDone),
    gaps: data.gaps || { required: [], defaulted: [], optional: [], derived: [] },
    hasRequiredGaps: Boolean(data.hasRequiredGaps),
  };
}

/**
 * Step 2b: Apply an answer, confirmation, or decline action immutably.
 *
 * @param {any} spec
 * @param {{
 *   path?: string;
 *   value?: any;
 *   declined?: boolean;
 *   action?: "confirm" | "decline";
 *   answers?: Array<{ path: string; value?: any; action?: "confirm" | "decline"; declined?: boolean }>;
 * }} answer
 * @returns {Promise<any>} The updated EventSpec
 */
export async function submitAnswer(spec, answer) {
  const { ok, data } = await postJson("/intake/answer", { spec, answer });

  if (!ok || data?.status !== "ok") {
    const err = data?.error || { code: "ANSWER_ERROR", message: "Failed to apply answer." };
    throw new ApiError(err.code, err.message, err.issues);
  }

  return data.spec;
}

/**
 * Step 3: Validate and lock the EventSpec into an immutable version.
 *
 * @param {any} spec
 * @returns {Promise<{ spec: any; locked: boolean }>}
 */
export async function lockSpec(spec) {
  const { ok, data } = await postJson("/intake/lock", { spec });

  if (!ok || data?.status !== "ok") {
    const err = data?.error || { code: "LOCK_ERROR", message: "Failed to lock specification." };
    throw new ApiError(err.code, err.message, err.issues);
  }

  return { spec: data.spec, locked: Boolean(data.locked) };
}
