# API Contract (D-38)

Status: contract draft for A2. This document is documents-only work. It is the
boundary between `server/` and `client/`.

## Reading this document

- **REAL** means the shape is present in the source that was inspected.
- **PLANNED** means no HTTP handler or published shape exists yet. The server
  must add and validate that shape before the client relies on it.
- The read-only core/export source was inspected from the sibling checkout
  `C:\Users\Prakashkumar\Content-Marketing-Studio`. The A2 data-pipeline
  source was inspected in this checkout.
- No field is implied by a PLANNED shape. Open questions at the end must be
  resolved before implementation.

## 1. Common HTTP rules

JSON request and response bodies use UTF-8. File uploads may use a multipart
request once the route field names are implemented. Every endpoint uses the
same error body:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "A plain-language explanation of what went wrong.",
    "issues": [
      {
        "severity": "error",
        "code": "TEXT_OVERFLOW",
        "nodeId": "name",
        "message": "Text exceeds its bounding box"
      }
    ]
  }
}
```

`error.code` is required. `error.message` is required. `error.issues` is
optional and, when present at the API error boundary, contains core `Issue`
objects exactly:

```js
{
  severity: "error" | "warning",
  code: "TEXT_TRUNCATED" | "TEXT_OVERFLOW" | "TEXT_UNSUPPORTED_GLYPH" |
    "OVERLAP" | "LOGO_DISTORTED" | "LOGO_CLEARSPACE" | "LOGO_TOO_SMALL" |
    "LOGO_MISSING" | "OUTSIDE_SAFE_MARGIN" | "LOW_CONTRAST" |
    "QR_TOO_SMALL" | "UNFILLED_DATA" | "UNCONFIRMED_VALUE" |
    "PHOTO_LOW_RES" | "NO_PHOTO" | "EVENT_NAME_DOES_NOT_FIT" |
    "UNKNOWN_ROLE_ID" | "ELEMENT_DROPPED",
  nodeId?: string,
  message: string
}
```

The `code` list above is the current `IssueCode` enum. A2 row-report entries
are a separate, real pipeline diagnostic shape and may carry row-specific
fields; they are not silently converted into API `Issue` objects.

Common planned HTTP codes are listed per endpoint. The route must not invent a
second error envelope for validation, storage, export, or upload failures.

## 2. REAL core shapes

### 2.1 EventSpec

**REAL**: this is the current `core/schemas.js` shape. `roles` is at
`eventSpec.roles`, not inside `eventSpec.event`.

```js
EventSpec = {
  schemaVersion: 1,
  designType: "id-card",
  event: {
    name: ProvenanceField<string>,
    tagline: ProvenanceField<string>,
    venue: ProvenanceField<string>,
    dates: ProvenanceField<string[]>,
    palette?: string[], // 1 to 3 six-digit hex colours
  },
  roles: RoleSpec[], // at least one
  fields: ProvenanceField<string[]>,
  card: {
    widthMm: number,
    heightMm: number,
    orientation: "portrait" | "landscape",
    bleedMm: number,
    safeMarginMm: number,
    sides: "front" | "back" | "both",
  },
  qr: {
    enabled: boolean,
    urlPattern: string,
  },
}

RoleSpec = {
  id: string,
  label: string,
  expectedCount: integer >= 0,
  color: ProvenanceField<hex colour>,
}

ProvenanceField<T> = {
  value: T | null,
  status: "unknown" | "provided" | "declined" | "defaulted",
  source?: "brief" | "answer" | "default" | "suggestion" | "import",
  confirmed?: boolean,
}
```

The current schema also permits the additive `event.palette` array. It does
not define an event code, project id, version id, logo upload, or AI prompt
field inside `EventSpec`.

**REAL example:**

```json
{
  "schemaVersion": 1,
  "designType": "id-card",
  "event": {
    "name": { "value": "24-hour Hackathon", "status": "provided", "source": "brief", "confirmed": true },
    "tagline": { "value": null, "status": "declined", "source": "answer", "confirmed": true },
    "venue": { "value": "SVNIT, Surat", "status": "provided", "source": "brief", "confirmed": true },
    "dates": { "value": ["2026-10-18"], "status": "provided", "source": "brief", "confirmed": true },
    "palette": ["#2563EB", "#16A34A"]
  },
  "roles": [
    {
      "id": "participant",
      "label": "PARTICIPANT",
      "expectedCount": 200,
      "color": { "value": "#2563EB", "status": "defaulted", "source": "default", "confirmed": true }
    },
    {
      "id": "mentor",
      "label": "MENTOR",
      "expectedCount": 20,
      "color": { "value": "#16A34A", "status": "defaulted", "source": "default", "confirmed": true }
    }
  ],
  "fields": {
    "value": ["name", "role", "id", "photo", "qr"],
    "status": "provided",
    "source": "answer",
    "confirmed": true
  },
  "card": {
    "widthMm": 54,
    "heightMm": 85.6,
    "orientation": "portrait",
    "bleedMm": 3,
    "safeMarginMm": 3,
    "sides": "front"
  },
  "qr": {
    "enabled": true,
    "urlPattern": "https://example.org/checkin/{id}"
  }
}
```

### 2.2 Person

**REAL**: the data pipeline returns validated `Person` rows with this shape.

```js
Person = {
  id: string,
  name: string,
  roleId: string,
  org?: string,
  email?: string,
  photo: string | null,
  checkinUrl?: string,
  flags: string[],
}
```

IDs already present in the input are kept as-is after trimming. Generated IDs
are deterministic; this convention does not rewrite imported IDs.

## 3. REAL A2 data report

`buildDataset()` returns:

```js
{ people: Person[], report: A2Report }
```

The **REAL** report shape currently produced by `server/data/pipeline.js` is:

```js
A2Report = {
  format: string,
  firstSheet?: string,
  delimiter?: string,
  headerRow: number,
  headers: string[],
  mapping: {
    columns: MappingColumn[],
    mapping: Record<string, number>,
    competing: Record<string, MappingCandidate[]>,
    unmappedHeaders: string[],
    missingRequiredFields: string[],
  },
  rows: RowReport[],
  totals: {
    rows: number,
    ok: number,
    warnings: number,
    errors: number,
  },
  formulaLikeCells: number,
  matchedPhotos: MatchedPhoto[],
  unmatchedPhotoFiles: string[],
  unmatchedRows: number[],
  longNameMeasurement: {
    appliedCharacterThreshold: number,
    note: string,
  },
  limits: {
    maxRows: number,
    maxInputBytes: number,
    maxPhotoEntries: number,
    maxPhotoEntryCompressedBytes: number,
    maxPhotoEntryUncompressedBytes: number,
    maxPhotoTotalUncompressedBytes: number,
    maxPhotoPixels: number,
    maxZipBytes: number,
    maxZipEntries: number,
    maxZipEntryCompressedBytes: number,
    maxZipEntryUncompressedBytes: number,
    maxZipUncompressedBytes: number,
    maxImagePixels: number,
    maxMasterDimension: number,
    jpegQuality: number,
    lowPhotoDpi: number,
    defaultCropBias: number,
  },
}

MappingColumn = {
  columnIndex: number,
  source: string,
  target: string | null,
  confidence: number,
  candidates: { target: string, confidence: number }[],
  issue?: string,
  missingRequiredFields: string[],
}

MappingCandidate = {
  columnIndex: number,
  source: string,
  confidence: number,
}

RowReport = {
  rowNumber: number | null,
  id?: string,
  status: "OK" | "WARNING" | "ERROR",
  issues: A2RowIssue[],
}

MatchedPhoto = {
  rowNumber: number | null,
  id: string | null,
  file: string | null,
  method: string,
}
```

`A2RowIssue` is **REAL but intentionally open-ended** because the current
pipeline does not publish a Zod schema for it. Every entry has `code` and
`severity`; source code adds fields such as `rowNumber`, `message`, `field`,
`value`, `length`, `effectiveDpi`, and `file` when the issue needs them. The
server must preserve the returned entries rather than inventing a narrower
schema. Known row codes include:

`EMPTY_ROW`, `MISSING_REQUIRED_FIELD`, `MISSING_NAME`, `MISSING_ROLE`,
`HEADER_COLLISION`, `UNMAPPED_HEADER`, `UNKNOWN_ROLE_ID`, `DUPLICATE_ID`,
`DUPLICATE_EMAIL`, `INVALID_ROW`, `LONG_NAME`, `NO_PHOTO`, `LOW_PHOTO_DPI`,
`MISSING_OPTIONAL_FIELD`, `CONTROL_CHARACTERS_REMOVED`,
`UNSUPPORTED_PHOTO_FORMAT`, `CORRUPT_PHOTO`, `UNMATCHED_PHOTO`,
`UNMATCHED_ROW`, `PHOTO_MATCH_AMBIGUOUS`, and `FORMULA_LIKE_CELL`.

**REAL example:**

```json
{
  "people": [
    {
      "id": "HX26-P-001",
      "name": "Aarav Mehta",
      "roleId": "participant",
      "org": "SVNIT",
      "email": "aarav@example.com",
      "photo": null,
      "checkinUrl": "https://example.org/checkin/HX26-P-001",
      "flags": ["NO_PHOTO"]
    }
  ],
  "report": {
    "format": "csv",
    "delimiter": ",",
    "headerRow": 1,
    "headers": ["ID", "Full Name", "Role", "Organization", "Email"],
    "mapping": {
      "columns": [
        { "columnIndex": 0, "source": "ID", "target": "id", "confidence": 1, "candidates": [{ "target": "id", "confidence": 1 }], "missingRequiredFields": [] },
        { "columnIndex": 1, "source": "Full Name", "target": "name", "confidence": 1, "candidates": [{ "target": "name", "confidence": 1 }], "missingRequiredFields": [] },
        { "columnIndex": 2, "source": "Role", "target": "roleId", "confidence": 1, "candidates": [{ "target": "roleId", "confidence": 1 }], "missingRequiredFields": [] },
        { "columnIndex": 3, "source": "Organization", "target": "org", "confidence": 1, "candidates": [{ "target": "org", "confidence": 1 }], "missingRequiredFields": [] },
        { "columnIndex": 4, "source": "Email", "target": "email", "confidence": 1, "candidates": [{ "target": "email", "confidence": 1 }], "missingRequiredFields": [] }
      ],
      "mapping": { "id": 0, "name": 1, "roleId": 2, "org": 3, "email": 4 },
      "competing": {},
      "unmappedHeaders": [],
      "missingRequiredFields": []
    },
    "rows": [
      {
        "rowNumber": 2,
        "id": "HX26-P-001",
        "status": "WARNING",
        "issues": [
          { "code": "NO_PHOTO", "severity": "warning", "rowNumber": 2, "message": "No photo was supplied" }
        ]
      }
    ],
    "totals": { "rows": 1, "ok": 0, "warnings": 1, "errors": 0 },
    "formulaLikeCells": 0,
    "matchedPhotos": [],
    "unmatchedPhotoFiles": [],
    "unmatchedRows": [],
    "longNameMeasurement": {
      "appliedCharacterThreshold": 40,
      "note": "LONG_NAME is only a hint. Preflight decides whether the real name fits the selected design."
    },
    "limits": {
      "maxRows": 1000,
      "maxInputBytes": 26214400,
      "maxPhotoEntries": 300,
      "maxPhotoEntryCompressedBytes": 8388608,
      "maxPhotoEntryUncompressedBytes": 8388608,
      "maxPhotoTotalUncompressedBytes": 2516582400,
      "maxPhotoPixels": 40000000,
      "maxZipBytes": 2516582400,
      "maxZipEntries": 300,
      "maxZipEntryCompressedBytes": 8388608,
      "maxZipEntryUncompressedBytes": 8388608,
      "maxZipUncompressedBytes": 2516582400,
      "maxImagePixels": 40000000,
      "maxMasterDimension": 2400,
      "jpegQuality": 90,
      "lowPhotoDpi": 200,
      "defaultCropBias": 0.2
    }
  }
}
```

The report is deterministic for the same input and mapping. CSV, XLSX, and
JSON tabular input are supported by the A2 parser. A photo ZIP accepts JPEG,
PNG, and WebP entries and reports matching/unmatched files and rows.

## 4. Endpoint contract (REAL Server Implementation - Task S)

The HTTP endpoints below are implemented in `server/app.js` and `server/routes/`.
Every endpoint uses the common error envelope: `{ error: { code, message, issues? } }`.

### 4.1 System & Health

#### `GET /health` (REAL)
- **Request:** none.
- **Response (200):** `{ "status": "ok", "storage": "mongo" | "memory" }`
- **Errors:** 503 `{ "status": "error", "storage": "mongo" }` when database ping fails.

### 4.2 Projects

#### `POST /projects` — create a project (REAL)
- **Request body:**
  ```json
  {
    "name": "NIT Surat Hackathon 2026",
    "eventSpec": { /* valid EventSpec */ },
    "eventCode": "NSH26" /* optional: 2-8 uppercase alphanumeric, derived if omitted */
  }
  ```
- **Response body (201):** Project document with `peopleCount` (`id`, `name`, `eventCode`, `eventSpec`, `datasetReport: null`, `peopleCount: 0`, `currentDrafts: null`, `versions: []`, `createdAt`, `updatedAt`).
- **Possible errors:** 400 `INVALID_REQUEST` / `INVALID_EVENT_SPEC`.

#### `GET /projects` — list projects (REAL)
- **Request:** none.
- **Response body (200):** Array of project summaries `[{ id, name, eventCode, createdAt, updatedAt }]`.

#### `GET /projects/:id` — get one project (REAL)
- **Request:** none.
- **Response body (200):** Project document with `peopleCount` (personal data privacy: no `people` array).
- **Possible errors:** 400 `INVALID_PROJECT_ID`, 404 `NOT_FOUND`.

#### `PUT /projects/:id` — update project metadata (REAL)
- **Request body:** `{ "name"?: string, "eventCode"?: string }`
- **Response body (200):** Updated project document with `peopleCount` (no `people` array).
- **Possible errors:** 400 `INVALID_PROJECT_ID` / `INVALID_REQUEST`, 404 `NOT_FOUND`.

#### `PUT /projects/:id/event-spec` — update EventSpec (REAL)
- **Request body:** `{ "eventSpec": { /* valid EventSpec */ } }`
- **Response body (200):** `{ "status": "ok", "eventSpec": { ... } }`
- **Possible errors:** 400 `INVALID_PROJECT_ID` / `INVALID_EVENT_SPEC`, 404 `NOT_FOUND`.

#### `DELETE /projects/:id` — delete project & disk photos (REAL)
- **Request:** none.
- **Response body (200):** `{ "status": "ok" }`
- **Possible errors:** 400 `INVALID_PROJECT_ID`, 404 `NOT_FOUND`.

### 4.3 Data & Photos Upload

#### `POST /projects/:id/data` — upload tabular data (REAL)
- **Request:** Raw bytes (CSV, XLSX, or JSON) via `express.raw({ limit: 25MB })`.
- **Query params:** `?kind=csv|xlsx|json` (optional), `?mapping=<json_encoded_mapping>` (optional).
- **Processing:** Calls `server/data/buildDataset` with the project's `eventSpec` and `eventCode`. Auto-proposes mapping if omitted. Cleaned participant rows without fatal errors are stored in server database/storage. If some rows contain errors (e.g. unknown role), those error rows are excluded from stored participants and reported in `report.rows`; the upload succeeds with status 200 and returns `{ report }`. Status 422 is returned only when zero valid participant rows remain (or on dataset parse failure), and the full A2 `report` is still included in the 422 response body so the GUI can present error details.
- **Response body (200):** `{ "report": A2Report }`.
- **Privacy constraint:** The response contains ONLY the A2 dataset report. Raw participant rows, names, and emails are NOT returned to the client.
- **Possible errors:** 400 `EMPTY_BODY` / `PARSE_ERROR` / `UNSUPPORTED_FORMAT`, 404 `NOT_FOUND`, 413 `PAYLOAD_TOO_LARGE`, 422 `DATA_VALIDATION_ERROR` (when zero valid participant rows remain, with `report` included).

#### `POST /projects/:id/photos` — upload photo ZIP archive (REAL)
- **Request:** Raw bytes (ZIP archive) via `express.raw({ limit: 300MB })`.
- **Processing:** Streams ZIP, normalizes JPEG/PNG/WebP photos to disk under `os.tmpdir()/acm-studio/<projectId>/`, matches photos to participant rows, updates stored people records.
- **Response body (200):** `{ matches: MatchedPhoto[], unmatchedFiles: string[], unmatchedRows: number[], warnings: any[] }`.
- **Possible errors:** 400 `NO_DATASET` / `EMPTY_BODY`, 404 `NOT_FOUND`, 413 `PAYLOAD_TOO_LARGE`.

### 4.4 Drafts

#### `POST /projects/:id/drafts` — compose layout drafts (REAL)
- **Request body:** `{ "count"?: number, "seed"?: string | number }` (default count: 3).
- **Processing:** Invokes core `composeDrafts` with preloaded fonts and brand assets, verifies preview SVGs, saves drafts to project storage.
- **Response body (200):** `{ "drafts": Draft[], "seed": string | number, "issues": Issue[] }`.
- **Possible errors:** 400 `INVALID_PROJECT_ID`, 404 `NOT_FOUND`, 422 `NO_VALID_DRAFT`.

### 4.5 Versions

#### `POST /projects/:id/versions` — snapshot immutable version (REAL)
- **Request body:** `{ "draftIndex": 0 | 1 | 2, "note"?: string }`.
- **Processing:** Snapshots the chosen composed draft and current cleaned participant rows into immutable version N.
- **Response body (201):** `{ "versionNumber": number, "draftIndex": number, "draft": any, "peopleCount": number, "timestamp": string, "note"?: string }`. (Participant personal data is never returned; `peopleCount` indicates total participants in snapshot).
- **Possible errors:** 400 `NO_DRAFTS` / `NO_DATASET` / `INVALID_REQUEST`, 404 `NOT_FOUND`.

#### `GET /projects/:id/versions` — list saved versions (REAL)
- **Request:** none.
- **Response body (200):** Array of saved version objects (each with `peopleCount` instead of `people`).
- **Possible errors:** 400 `INVALID_PROJECT_ID`, 404 `NOT_FOUND`.

### 4.6 Export

#### `POST /projects/:id/export` — execute card, sheet, or batch export (REAL)
- **Request body:**
  ```json
  {
    "version": 1,               /* optional: defaults to latest saved version */
    "kind": "sheet",            /* "card" | "sheet" | "zip" (default: "sheet") */
    "format": "pdf",            /* "svg" | "png" | "pdf" (for kind: "card") */
    "personId": "HX26-P-001",   /* required when kind: "card" */
    "printerSafeMm": 5,         /* optional: sheet printer margin (0-20mm) */
    "paper": "A4",              /* optional: "A4" | "A3" | "custom" */
    "orientation": "portrait",  /* "portrait" only (landscape refused with 422) */
    "sides": "front",           /* "front" only (back/both refused with 422) */
    "acknowledgedWarnings": true /* required to proceed if warnings present */
  }
  ```
- **Concurrency:** Locked to 1 active export per project at a time. Simultaneous requests receive 409 `EXPORT_IN_PROGRESS`.
- **Timeouts:** Server socket/header timeout configured to 10 minutes (600,000ms).
- **Client Disconnect:** On early request abort, active Chromium browser instances are automatically closed.
- **Rule D-09 Preflight Gate:** Strictly enforced prior to output generation. If any error issue or unacknowledged warning is present, returns 422 `{ error: { code: "PREFLIGHT_FAILED", message: reason, issues } }` and writes 0 bytes.
- **Response:** Binary stream with appropriate headers:
  - `Content-Type: application/pdf` | `image/svg+xml` | `image/png` | `application/zip`
  - `Content-Disposition: attachment; filename="<id-based-filename>"`
- **Possible errors:** 400 `INVALID_EXPORT_SETTINGS` / `NO_SAVED_VERSION` / `MISSING_PERSON_ID`, 404 `NOT_FOUND` / `VERSION_NOT_FOUND` / `PERSON_NOT_FOUND`, 409 `EXPORT_IN_PROGRESS`, 422 `UNSUPPORTED_ORIENTATION` / `UNSUPPORTED_SIDES` / `PREFLIGHT_FAILED`.

### 4.7 Export Progress & Downloads
- Export progress endpoint deferred tonight (TODO).
- Downloads are streamed directly in the `POST /projects/:id/export` response.

### 4.8 Intake & AI Gateway (REAL - Task I)

The 4 intake endpoints are: `POST /intake/parse`, `POST /intake/questions`, `POST /intake/answer`, `POST /intake/lock`.

#### `POST /intake/parse` - parse brief with Gemini structured JSON (REAL)
- **Request body:**
  ```json
  {
    "brief": "ID cards for 24-hour Hackathon at SVNIT Surat on 2026-10-20 with 200 participants",
    "today": "2026-10-20" /* optional YYYY-MM-DD date override for deterministic tests */
  }
  ```
- **Processing:** Calls Gemini REST via native `fetch` in JSON mode using `GEMINI_MODEL` (default `gemini-3.8-flash`) and `GEMINI_API_KEY`. Enforces D-02 zero-invention prompt. Performs KB 7.1 step 4 evidence check discarding untraced hallucinated values (checks `name`, `venue`, `tagline`, `dates`, `roles`, `palette`, `fields`). Surviving values marked `status: "provided"`, `source: "brief"`, `confirmed: false`. Counts like "200 participants" fill `roles[].expectedCount` only. Detects `designType` keyword ("id-card"); leaves unset if unknown. Retries once on failure.
- **Privacy & Logging:** Participant names, emails, and photos are NEVER sent to AI (D-10). Logs brief length and outcome ONLY (`[AI Intake] brief length: N, outcome: ok|retry|failed`), never the brief text or API key.
- **Response body (200):** `{ "status": "ok", "spec": EventSpec, "designType": "id-card" | null }`
- **Fallback response (422):** `{ "error": { "code": "BRIEF_PARSE_FAILED" | "AI_UNAVAILABLE", "message": string }, "emptySpec": EventSpec }` (provides emptySpec directly so UI opens manual form immediately).
- **Possible errors:** 400 `INVALID_REQUEST`, 422 `BRIEF_PARSE_FAILED` / `AI_UNAVAILABLE`.

#### `POST /intake/questions` - follow-up question bank & gap status (REAL)
- **Request body:** `{ "spec": EventSpec, "declined": ["event.tagline"] /* optional */ }`
- **Processing:** Selects 3 to 5 questions in 2 or 3 steps from question bank. Step 1 (Basics: name, venue, dates, designType), Step 2 (Roles, fields), Step 3 (Optional: tagline, palette). Declined fields are never asked again. D-39 strictly enforced: no QR questions, no photo questions, no landscape or back side questions.
- **Response body (200):**
  ```json
  {
    "status": "ok",
    "questions": [ /* 3 to 5 Question objects */ ],
    "currentStep": 1,
    "totalSteps": 3,
    "allDone": false,
    "gaps": {
      "required": [ /* { path, label, reason } */ ],
      "defaulted": [ /* { path, label, value } */ ],
      "optional": [ /* { path, label, reason } */ ],
      "derived": [ /* { path, label, reason, value? } */ ]
    },
    "hasRequiredGaps": true
  }
  ```
- **Possible errors:** 400 `INVALID_REQUEST`.

#### `POST /intake/answer` - apply user answer or confirmation immutably (REAL)
- **Request body:**
  Supports answering with a new value, or confirming/declining brief-extracted values (`action: "confirm" | "decline"`):
  ```json
  {
    "spec": { /* current EventSpec */ },
    "answer": {
      "path": "event.name",
      "action": "confirm"
    }
  }
  ```
  *(Or with value: `{ "path": "event.dates", "value": ["2026-10-20"] }` or `{ "path": "event.tagline", "action": "decline" }`)*
- **Processing:** Deep-clones spec and validates answer without mutating input.
  - When `action: "confirm"` is passed, sets `confirmed: true` on the existing brief-parsed value without requiring the user to retype it. Returns error `CANNOT_CONFIRM_EMPTY` if the field has no value.
  - When `action: "decline"` or `declined: true` is passed, declines optional fields (`status: "declined"`, `confirmed: true`, `value: null`) and removes the element. Returns `CANNOT_DECLINE_REQUIRED` on required fields.
  - Role IDs formatted as lowercase slugs; uncolored roles assigned default colors with >= 15% lightness spacing. Validates real calendar dates (valid year/month/day). Blocks landscape, back sides, and QR toggles (D-39).
- **Response body (200):**
  ```json
  {
    "status": "ok",
    "spec": {
      "event": {
        "name": {
          "value": "24-hour Hackathon",
          "status": "provided",
          "source": "brief",
          "confirmed": true
        }
      }
    }
  }
  ```
- **Possible errors:** 400 `INVALID_REQUEST`, 422 `CANNOT_DECLINE_REQUIRED` / `CANNOT_CONFIRM_EMPTY` / `INVALID_CALENDAR_DATE` / `INVALID_FIELD_VALUE` / `UNSUPPORTED_CONFIGURATION`.

#### `POST /intake/lock` - lock spec into immutable version (REAL)
- **Request body:** `{ "spec": EventSpec }`
- **Processing:** One-line lock rule: A spec is locked only if it satisfies EventSpec, has zero required gaps, and contains zero unconfirmed suggestions. Deep-freezes spec.
- **Response body (200):** `{ "status": "ok", "spec": EventSpec, "locked": true }`
- **Possible errors:** 400 `INVALID_REQUEST`, 422 `SPEC_HAS_GAPS` / `UNCONFIRMED_SUGGESTION` / `INVALID_EVENT_SPEC`.

## 5. Storage & Privacy Architecture (REAL)

1. **Storage Models**: Defined with Zod in `server/storage/schemas.js` (`ProjectSchema`, `VersionSchema`, `StoredPersonSchema`).
2. **Personal Data Privacy**: Names, emails, and photos are personal data. They are stored in MongoDB/memory strictly for card export execution, but NEVER logged, NEVER included in error bodies, and NEVER returned to the client in project or version responses (all client responses return `peopleCount` instead of `people` arrays; dataset upload returns `{ report }` only).
3. **Photo Storage**: Photos are kept on disk under `os.tmpdir()/acm-studio/<projectId>/` and streamed on demand via `photoSource`. Deleting a project deletes its disk photo folder.
4. **CORS**: Zero external packages. Hand-rolled middleware in `server/cors.js` whitelist-restricts origins to `http://localhost:5173`, `http://localhost:3000`, and `ALLOWED_ORIGINS`.

## 6. Hand-check list

1. Does every listed endpoint show method, path, request body, response body, and possible errors? (YES)
2. Are all endpoints validated at boundaries with Zod schemas? (YES)
3. Does the EventSpec put roles at `eventSpec.roles`, and does the A2 upload response expose the real `{ report }` shape without leaking participant personal data? (YES)
4. Are all export formats (card SVG/PNG/PDF, sheet PDF, batch ZIP) gated by D-09 preflight checks? (YES)
5. Does every API error use one envelope with `code`, `message`, and optional `issues`? (YES)
