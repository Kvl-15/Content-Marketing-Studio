// @ts-check
/**
 * @module client/src/api
 * Plain fetch API client for Content Marketing Studio REST endpoints.
 * Target: import.meta.env.VITE_API_URL || "http://localhost:3000"
 */

const BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

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
 * Helper to execute GET requests with clean error extraction.
 *
 * @param {string} path
 * @returns {Promise<any>}
 */
async function getJson(path) {
  const url = `${BASE_URL}${path}`;

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
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
 * Helper to execute raw binary POST requests with clean error extraction.
 *
 * @param {string} path
 * @param {Blob | ArrayBuffer | Uint8Array} body
 * @param {string} [contentType]
 * @returns {Promise<any>}
 */
async function postRaw(path, body, contentType = "application/octet-stream") {
  const url = `${BASE_URL}${path}`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        Accept: "application/json",
      },
      body,
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

/**
 * Slice 2: Fetch list of saved project summaries (GET /projects).
 *
 * @returns {Promise<Array<{
 *   id: string;
 *   name: string;
 *   eventCode: string;
 *   createdAt: string;
 *   updatedAt: string;
 * }>>}
 */
export async function listProjects() {
  const { ok, status, data } = await getJson("/projects");

  if (!ok) {
    const err = data?.error || {
      code: "FETCH_FAILED",
      message: `Failed to fetch projects (HTTP ${status}).`,
    };
    throw new ApiError(err.code, err.message, err.issues);
  }

  return Array.isArray(data) ? data : [];
}

/**
 * Slice 2: Fetch full details for a single project (GET /projects/:id).
 *
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function getProject(id) {
  const { ok, status, data } = await getJson(`/projects/${encodeURIComponent(id)}`);

  if (!ok) {
    const err = data?.error || {
      code: status === 404 ? "NOT_FOUND" : "FETCH_FAILED",
      message: `Failed to fetch project ${id} (HTTP ${status}).`,
    };
    throw new ApiError(err.code, err.message, err.issues);
  }

  return data;
}

/**
 * Slice 2: Create a project with a locked EventSpec (POST /projects).
 *
 * @param {{
 *   name: string;
 *   eventSpec: any;
 *   eventCode?: string;
 * }} params
 * @returns {Promise<any>} The created public project
 */
export async function createProject({ name, eventSpec, eventCode }) {
  const payload = {
    name,
    eventSpec,
    ...(eventCode ? { eventCode } : {}),
  };

  const { ok, status, data } = await postJson("/projects", payload);

  if (!ok) {
    const err = data?.error || {
      code: "CREATE_FAILED",
      message: `Failed to create project (HTTP ${status}).`,
    };
    throw new ApiError(err.code, err.message, err.issues);
  }

  return data;
}

/**
 * Slice 2: Upload participant tabular data (POST /projects/:id/data).
 * Accepts raw file bytes (CSV, XLSX, JSON).
 *
 * @param {string} projectId
 * @param {Blob | ArrayBuffer | Uint8Array} fileData
 * @param {{
 *   kind?: "csv" | "xlsx" | "json";
 *   mapping?: Record<string, any>;
 *   contentType?: string;
 * }} [options]
 * @returns {Promise<{ ok: boolean; report: any }>}
 */
export async function uploadProjectData(projectId, fileData, options = {}) {
  const params = new URLSearchParams();
  if (options.kind) params.set("kind", options.kind);
  if (options.mapping) params.set("mapping", JSON.stringify(options.mapping));
  const qs = params.toString() ? `?${params.toString()}` : "";

  const { ok, status, data } = await postRaw(
    `/projects/${encodeURIComponent(projectId)}/data${qs}`,
    fileData,
    options.contentType || "application/octet-stream"
  );

  if (ok && data?.report) {
    return { ok: true, report: data.report };
  }

  // 422: zero valid participants found, returns full report alongside error
  if (status === 422 && data?.report) {
    const err = new ApiError(
      data.error?.code || "DATA_VALIDATION_ERROR",
      data.error?.message || "Data validation failed",
      data.error?.issues
    );
    // @ts-ignore attach report for GUI rendering
    err.report = data.report;
    throw err;
  }

  const err = data?.error || {
    code: status === 413 ? "PAYLOAD_TOO_LARGE" : "DATA_UPLOAD_FAILED",
    message: `Failed to upload participant data (HTTP ${status}).`,
  };
  throw new ApiError(err.code, err.message, err.issues);
}

/**
 * Slice 2: Upload photo ZIP archive (POST /projects/:id/photos).
 * Accepts raw ZIP bytes.
 *
 * @param {string} projectId
 * @param {Blob | ArrayBuffer | Uint8Array} zipData
 * @returns {Promise<{
 *   matches: Array<{ rowNumber: number | null; id: string | null; file: string | null; method: string }>;
 *   unmatchedFiles: string[];
 *   unmatchedRows: number[];
 *   warnings: any[];
 * }>}
 */
export async function uploadProjectPhotos(projectId, zipData) {
  const { ok, status, data } = await postRaw(
    `/projects/${encodeURIComponent(projectId)}/photos`,
    zipData,
    "application/zip"
  );

  if (ok) {
    return {
      matches: Array.isArray(data.matches) ? data.matches : [],
      unmatchedFiles: Array.isArray(data.unmatchedFiles) ? data.unmatchedFiles : [],
      unmatchedRows: Array.isArray(data.unmatchedRows) ? data.unmatchedRows : [],
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
    };
  }

  const err = data?.error || {
    code: status === 413 ? "PAYLOAD_TOO_LARGE" : "PHOTO_UPLOAD_FAILED",
    message: `Failed to upload photo archive (HTTP ${status}).`,
  };
  throw new ApiError(err.code, err.message, err.issues);
}

/**
 * ID Card Design Generation: Compose drafts for a project (POST /projects/:id/drafts).
 *
 * @param {string} projectId
 * @param {{ count?: number; seed?: string | number }} [options]
 * @returns {Promise<{ drafts: any[]; seed: string | number; issues: any[] }>}
 */
export async function composeProjectDrafts(projectId, options = {}) {
  const { ok, status, data } = await postJson(
    `/projects/${encodeURIComponent(projectId)}/drafts`,
    options
  );

  if (ok && data?.drafts) {
    return data;
  }

  const err = data?.error || {
    code: status === 422 ? "NO_VALID_DRAFT" : "DRAFTS_FAILED",
    message: `Failed to compose design drafts (HTTP ${status}).`,
  };
  throw new ApiError(err.code, err.message, err.issues);
}

/**
 * Version Snapshotting: Save chosen draft and dataset into an immutable version (POST /projects/:id/versions).
 *
 * @param {string} projectId
 * @param {{ draftIndex: number; note?: string }} params
 * @returns {Promise<{
 *   versionNumber: number;
 *   draftIndex: number;
 *   draft: any;
 *   peopleCount: number;
 *   timestamp: string;
 *   note?: string;
 * }>}
 */
export async function saveProjectVersion(projectId, { draftIndex, note }) {
  const { ok, status, data } = await postJson(
    `/projects/${encodeURIComponent(projectId)}/versions`,
    { draftIndex, ...(note ? { note } : {}) }
  );

  if (ok) {
    return data;
  }

  const err = data?.error || {
    code: "VERSION_FAILED",
    message: `Failed to save project version (HTTP ${status}).`,
  };
  throw new ApiError(err.code, err.message, err.issues);
}

/**
 * List saved versions for a project (GET /projects/:id/versions).
 *
 * @param {string} projectId
 * @returns {Promise<Array<any>>}
 */
export async function listProjectVersions(projectId) {
  const { ok, status, data } = await getJson(
    `/projects/${encodeURIComponent(projectId)}/versions`
  );

  if (ok) {
    return Array.isArray(data) ? data : [];
  }

  const err = data?.error || {
    code: "VERSIONS_FETCH_FAILED",
    message: `Failed to fetch versions (HTTP ${status}).`,
  };
  throw new ApiError(err.code, err.message, err.issues);
}

/**
 * Slice 4: Export ID cards, print sheets, or batch ZIP (POST /projects/:id/export).
 * On HTTP 200: Returns blob, filename, mimeType, and size.
 * On error: Parses JSON error envelope and throws ApiError with code, message, issues.
 *
 * @param {string} projectId
 * @param {{
 *   version?: number;
 *   kind?: "card" | "sheet" | "zip";
 *   format?: "pdf" | "svg" | "png";
 *   personId?: string;
 *   paper?: "A4" | "A3" | "custom";
 *   printerSafeMm?: number;
 *   orientation?: "portrait" | "landscape";
 *   sides?: "front" | "back" | "both";
 *   acknowledgedWarnings?: boolean;
 *   dpi?: number;
 * }} [exportSettings]
 * @returns {Promise<{ blob: Blob; filename: string; mimeType: string; size: number }>}
 */
export async function exportProject(projectId, exportSettings = {}) {
  const url = `${BASE_URL}/projects/${encodeURIComponent(projectId)}/export`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/pdf, application/zip, image/svg+xml, image/png, application/json, */*",
      },
      body: JSON.stringify(exportSettings),
    });
  } catch {
    throw new ApiError(
      "NETWORK_ERROR",
      `Unable to connect to server at ${BASE_URL}. Ensure the backend is running.`
    );
  }

  if (response.ok) {
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition");
    let filename = "export-output";
    if (disposition) {
      const match = disposition.match(/filename="?([^";]+)"?/);
      if (match && match[1]) {
        filename = match[1];
      }
    }
    const mimeType = response.headers.get("Content-Type") || "application/octet-stream";
    return {
      blob,
      filename,
      mimeType,
      size: blob.size,
    };
  }

  // Handle errors (400, 404, 409, 422, 500)
  let errorJson = null;
  try {
    errorJson = await response.json();
  } catch {
    // Non-JSON error
  }

  const errData = errorJson?.error || {
    code:
      response.status === 409
        ? "EXPORT_IN_PROGRESS"
        : response.status === 422
          ? "PREFLIGHT_FAILED"
          : "EXPORT_FAILED",
    message: `Export failed (HTTP ${response.status}).`,
    issues: [],
  };

  throw new ApiError(errData.code, errData.message, errData.issues);
}
