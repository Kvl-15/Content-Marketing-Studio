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

## 4. Endpoint contract

The HTTP paths below follow Part 14.3 where a path exists. A route marked
**PLANNED** has no implemented handler in the inspected source. Its request
and response are deliberately not filled with guessed fields.

### 4.1 Projects

#### `POST /projects` — create a project (PLANNED)

- **Request body:** PLANNED. The source does not define whether creation
  accepts a brief, a form submission, or a complete `EventSpec`.
- **Response body:** PLANNED. The source does not define a project document or
  project identifier shape.
- **Possible errors:** `INVALID_REQUEST`, `INVALID_EVENT_SPEC`,
  `STORAGE_ERROR` (all PLANNED error mappings).

#### `GET /projects` — list projects (PLANNED)

- **Request body:** none.
- **Response body:** PLANNED. The source does not define the list item shape.
- **Possible errors:** `STORAGE_ERROR` (PLANNED).

#### `GET /projects/:id` — get one project (PLANNED)

- **Request body:** none.
- **Response body:** PLANNED. The source does not define the project document
  returned by storage.
- **Possible errors:** `NOT_FOUND`, `STORAGE_ERROR` (PLANNED).

### 4.2 EventSpec save and lock

#### `PATCH /projects/:id/spec` — save EventSpec answers (PLANNED)

- **Request body:** PLANNED. Part 14.3 says this applies answers validated per
  field, but no patch/answer shape exists in source. Do not assume a JSON Patch
  format or a field-path format.
- **Response body:** PLANNED. A saved spec should be validated as `EventSpec`,
  but the version/envelope shape is not defined.
- **Possible errors:** `NOT_FOUND`, `INVALID_REQUEST`, `INVALID_EVENT_SPEC`,
  `INVALID_STATE`, `STORAGE_ERROR` (PLANNED).

#### `POST /projects/:id/spec/lock` — lock a new EventSpec version (PLANNED)

- **Request body:** PLANNED. The source does not say whether the body is empty,
  the complete spec, or a version command.
- **Response body:** PLANNED. The locked snapshot itself must be a validated
  `EventSpec`; the immutable version envelope is not defined.
- **Possible errors:** `NOT_FOUND`, `INVALID_EVENT_SPEC`, `INVALID_STATE`,
  `STORAGE_ERROR` (PLANNED).

### 4.3 Data upload

#### `POST /projects/:id/data` — upload tabular data and an optional photo ZIP (PLANNED route; REAL pipeline result)

- **Request body:** PLANNED HTTP multipart field names. The underlying A2
  function accepts one tabular input, a confirmed `mapping` with type
  `Record<string, string | number>`, an `eventSpec`, and optional photo ZIP
  input. The tabular input may be CSV, XLSX, or JSON. The route must not send
  participant rows or photos to AI.
- **Response body:** **REAL pipeline result**: `{ people: Person[], report:
  A2Report }`. The full report shape and example are in section 3.
- **Row failures:** row-level errors and warnings are returned inside
  `report.rows`; they do not change the report shape. In particular, unknown
  roles, duplicate IDs, missing names, and photo problems remain visible in
  the report.
- **Possible errors:** `UNSUPPORTED_FORMAT`, `PARSE_ERROR`, and
  `VALIDATION_ERROR` are REAL `DataPipelineError` codes. `INVALID_REQUEST`,
  `NOT_FOUND`, and `STORAGE_ERROR` are PLANNED HTTP mappings.

#### `PATCH /projects/:id/data/mapping` — confirm column mapping (PLANNED)

- **Request body:** PLANNED route envelope. The underlying mapping value is a
  `Record<string, string | number>` and the report exposes the REAL mapping
  proposal shape in section 3.
- **Response body:** PLANNED. A subsequent upload response must be
  `{ people, report }`.
- **Possible errors:** `NOT_FOUND`, `INVALID_REQUEST`, `VALIDATION_ERROR`,
  `STORAGE_ERROR` (PLANNED, except the underlying `VALIDATION_ERROR` code).

#### Photo ZIP behavior (REAL pipeline facts)

The A2 pipeline matches a photo by ID, email, or filename stem, applies EXIF
rotation, converts to sRGB, removes metadata while writing JPEG masters, uses a
top-biased crop by default, and reports effective DPI. The input limits are
the values in `report.limits`; they must be shown or enforced by the server,
not silently changed by the client.

### 4.4 Draft composition

#### `POST /projects/:id/drafts` — compose drafts (PLANNED route; REAL core result)

- **Request body:** PLANNED route envelope. The underlying core call accepts
  an event object and options including `seed`, optional `previousArchetypes`,
  optional `previousSeeds`, `count`, `sampleSize`, and stress/font/brand
  inputs. The exact HTTP body is not defined.
- **Response body:** **REAL** `composeDrafts()` top-level result:

  ```js
  { drafts: Draft[], seed: string | number, issues: Issue[] }
  ```

  A current draft contains the composed `skeleton`, `blocks`, `theme`, and
  `look`, plus `seed`, `archetype`, `score`, `scoreDetails`; the current
  composer may also include `scene`, `svg`, `modeFallback`, `fonts`, and
  draft-level `issues`.
- **No valid draft:** if no valid draft can be selected, the HTTP route must
  return the common error body with `error.code: "NO_VALID_DRAFT"` and a plain
  message such as `No valid draft passed the stress set.`. This is a
  contract-level error mapping; no server route currently emits it.
- **Possible errors:** `NO_VALID_DRAFT`, `NOT_FOUND`, `INVALID_REQUEST`,
  `INVALID_STATE`, `STORAGE_ERROR` (PLANNED HTTP mappings). Core issues remain
  in the REAL `issues` array when drafts are returned.

### 4.5 Render a card

#### `POST /projects/:id/cards/:personId/render` — render one card (PLANNED route; REAL core result)

- **Request body:** PLANNED. The inspected `renderCard(input)` function
  accepts a record containing the design bundle and data, but the HTTP body
  and how the project resolves those inputs are not defined.
- **Response body:** **REAL** `renderCard()` result:

  ```js
  {
    svg: string,
    scene: SceneNode[],
    issues: Issue[],
    fixes: { code: string, nodeId?: string, action: string }[],
    trimBox: { x: number, y: number, w: number, h: number },
    bleedBox: { x: number, y: number, w: number, h: number },
    bleedMm: number,
  }
  ```

- **Possible errors:** `NOT_FOUND`, `INVALID_REQUEST`, `INVALID_STATE`,
  `RENDER_FAILED` (PLANNED HTTP mappings). Validation issues belong in the
  response `issues` array when rendering succeeds.

### 4.6 Save a version

#### `POST /projects/:id/versions` — save an immutable version (PLANNED)

- **Request body:** PLANNED. The source says saved versions are required but
  does not publish the version request shape.
- **Response body:** PLANNED. The source does not publish a version id,
  version number, or saved-version envelope.
- **Possible errors:** `NOT_FOUND`, `INVALID_REQUEST`, `INVALID_STATE`,
  `STORAGE_ERROR` (PLANNED).

### 4.7 Export

#### `POST /projects/:id/export` — start export (PLANNED HTTP route; REAL single-card implementation)

The route must use the current `core/exportSettings.js` `ExportSettingsSchema`
fields exactly. These are the fields; do not substitute the older Part 5
shape:

```js
{
  format: "svg" | "pdf" | "png",
  mode: "single" | "all" | "sheets",
  card: {
    widthMm: number,
    heightMm: number,
  },
  orientation: "portrait" | "landscape",
  dpi: integer,
  bleedMm: number,
  cropMarks?: boolean,
  sides: "front" | "back" | "both",
  textAsOutlines: boolean,
  groupByRole: boolean,
  duplexFlip: "long" | "short",
  printerSafeMm?: number,
  sheet: {
    paper: "A4" | "A3" | "custom",
    widthMm?: number,
    heightMm?: number,
    marginMm: number,
    gapMm: number,
    markLengthMm: number,
    markOffsetMm: number,
    markStrokeMm: number,
    printerSafeMm: number,
    duplexFlip?: "long" | "short",
  },
}
```

The parser applies defaults: `format: "pdf"`, `mode: "sheets"`, CR80 card
`54 x 85.6`, portrait, `dpi: 300`, `bleedMm: 3`, `sides: "front"`,
`textAsOutlines: true`, `groupByRole: false`, `duplexFlip: "long"`, A4 sheet,
and the sheet defaults from the schema. `cropMarks` defaults to true for
`mode: "sheets"` and false otherwise. Custom paper requires both dimensions.
The normalized parser result resolves the sheet dimensions and the effective
`printerSafeMm`/`duplexFlip`.

**E2a availability:**

- Single-card SVG and PNG are available through the inspected
  `exportCard()` implementation.
- `mode: "single"` is the only mode this contract exposes as implemented.
  `all` (ZIP) and `sheets` are **PLANNED until E2b** and must return
  `UNSUPPORTED_MODE` rather than pretending to work.
- PDF is refused until E2b with `UNSUPPORTED_FORMAT`.
- Landscape is refused with `UNSUPPORTED_ORIENTATION`.
- The D-09 gate always refuses when any issue has `severity: "error"`.
  Warnings refuse unless the request includes
  `acknowledgedWarnings: true`. A refused export writes nothing.
- The output filename is derived from `person.id` only. It never uses a
  person name or email. The filename sanitizer removes unsafe path characters,
  guards Windows device names, and uses `card` when the id is empty.

The inspected single-card implementation returns this **REAL** result on
success:

```js
{
  ok: true,
  fileName: string,
  mimeType: "image/svg+xml" | "image/png",
  data: string | Buffer,
  widthPx?: number,
  heightPx?: number,
  dpi?: number,
  issues: Issue[],
  warnings: Issue[],
}
```

For refusal, the implementation returns `ok: false`, `issues`, `errors`,
`warnings`, and `reason`. The HTTP route must translate that result into the
common error envelope; the JSON/base64/stream representation of `data` is
**PLANNED** because no HTTP transport implementation exists yet.

**Possible export errors:** `INVALID_INPUT_TYPE`,
`SCHEMA_VALIDATION_ERROR`, `INVALID_EXPORT_SETTINGS`,
`MISSING_CUSTOM_DIMENSIONS`, and `UNKNOWN_PAPER` come from the REAL
`ExportSettingsError`/settings parser. `UNSUPPORTED_FORMAT`,
`UNSUPPORTED_ORIENTATION`, `MISSING_FONTS`, and `MISSING_LOGO_ASSETS` are
REAL single-card refusal codes. `INVALID_ISSUES` is the REAL fail-closed gate
code. `UNSUPPORTED_MODE`, `EXPORT_REFUSED`, `NOT_FOUND`, `INVALID_STATE`, and
`STORAGE_ERROR` are planned HTTP mappings.

### 4.8 Export progress

#### `GET /exports/:id` — export progress (PLANNED)

- **Request body:** none.
- **Response body:** PLANNED. Part 13 says the frontend polls this endpoint,
  but no progress or export-record shape exists in the inspected source.
- **Possible errors:** `NOT_FOUND`, `EXPORT_FAILED`, `STORAGE_ERROR` (PLANNED).

### 4.9 Downloads

#### `GET /exports/:id/download` — download completed output (PLANNED path)

- **Request body:** none.
- **Response body:** PLANNED. The source does not define whether the server
  streams bytes, returns a URL, or returns a download record. The filename
  rule in section 4.7 still applies.
- **Possible errors:** `NOT_FOUND`, `DOWNLOAD_NOT_READY`, `STORAGE_ERROR`
  (PLANNED).

## 5. Open questions and assumptions

1. **Project persistence shape is missing.** The inspected source has no
   project, version, or export-record Zod schema. Create/list/get/save-version
   request and response bodies are therefore PLANNED.
2. **EventSpec save envelope is missing.** The source describes per-field
   answers but does not define the PATCH body or lock body.
3. **HTTP upload field names are missing.** The pipeline function has a real
   input/options API, but no multipart route. The names for the tabular file,
   photo ZIP, mapping, and event code must be agreed before server/client
   implementation.
4. **Draft and render route envelopes are missing.** Their core return shapes
   are REAL, but project lookup and HTTP request bodies are not.
5. **No valid draft mapping is missing.** `composeDrafts()` returns an empty
   `drafts` array when it cannot reach the requested count; this contract
   assumes the route maps that state to `NO_VALID_DRAFT`.
6. **Export transport is missing.** The core settings and single-card
   `exportCard()` result are REAL, but HTTP byte encoding, progress records,
   retention, and download URLs are not defined.
7. **E2b scope is assumed from the task.** Sheets, ZIP, and PDF are explicitly
   marked PLANNED here even though older knowledge-base examples describe
   them.
8. **`FRONTEND_NOTES.md` is guidance, not a new schema.** It must not be used
   to fill any PLANNED field in this document.

## Hand-check list

1. Does every listed endpoint show method, path, request body, response body,
   and possible errors?
2. Are all incomplete project/storage/HTTP envelope shapes marked PLANNED,
   with no guessed fields?
3. Does the EventSpec put roles at `eventSpec.roles`, and does the A2 upload
   response expose the real `{ people, report }` shape?
4. Are the exact export settings fields, D-09 acknowledgement rule,
   E2a format/orientation limits, and id-only filename rule present?
5. Does every API error use one envelope with `code`, `message`, and optional
   core-shaped `issues`?
