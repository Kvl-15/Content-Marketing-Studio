# Progress A2 — Data pipeline

Date: 2026-10-19
Person: A
Branch: `feature/a2-data`

## Done

- Added content-based CSV, JSON, and XLSX parsing under `server/data/`.
- Added BOM, comma/semicolon/tab delimiter, quoted-field, blank-line, title-row, header-only, duplicate-header, empty-header, malformed-input, binary-input, and typed-error handling.
- Added deterministic header mapping proposals with confidence, unmapped headers, competing candidates, and missing required fields.
- Added NFC cleaning, trimming, whitespace collapsing, control/zero-width removal reporting, and formula-like cell counting.
- Added exact case-insensitive role resolution against event roles. Missing, empty, and unknown roles produce `UNKNOWN_ROLE_ID` errors.
- Added stable IDs using event code, role letter, and running number. Existing IDs are preserved; duplicate IDs are errors and duplicate emails are warnings.
- IDs from CSV are kept as-is; the convention applies only to generated IDs. Existing IDs are reserved before generation, including case-insensitive matches. `sharp.cache(false)` is process-wide and is set in `server/data/photos.js` inside `processPhoto`; the server and export code must decide on it together.
- Added ZIP photo ingestion with `yauzl`, traversal checks, entry/size/pixel limits, JPEG/PNG/WebP validation, unsupported/corrupt warnings, ID/email/filename matching, EXIF rotation, sRGB conversion, metadata stripping, JPEG masters, top-biased crops, and effective DPI calculation. The dataset path streams one entry at a time and does not retain all decoded photos.
- Added HTTPS-only `buildCheckinUrl(id, urlPattern)` with URL-encoded IDs.
- Added `buildDataset()` with Zod `Person` validation, default error exclusion, row statuses, deterministic reports, unmatched photo/row lists, optional processed-photo output, QR URLs, and formula-like-cell totals.
- Added the requested messy fixture, `server/data/demo.js`, and a temporary demo ZIP builder that demonstrates ID, email, and filename matching plus unmatched files.
- Added A2b issue-code deduplication. A blank role reports `UNKNOWN_ROLE_ID` with the reason `Role is missing`; `INVALID_ROW` is only added when no specific error explains the validation failure.

## Files

- `server/data/`: parser, mapping, cleaning, role, ID, photo, QR, dataset, limits, demo, and tests.
- `fixtures/messy.csv`.
- `package.json` and `package-lock.json` for approved dependencies.

## Chosen limits and photo settings

- Maximum rows: 1,000.
- Maximum input file: 25 MiB.
- Maximum compressed ZIP: 2,400 MiB (300 × 8 MiB upper bound).
- Maximum ZIP entries: 300.
- Maximum compressed entry: 8 MiB.
- Maximum uncompressed entry: 8 MiB, counted from bytes actually decompressed while streaming, not only ZIP header declarations.
- Maximum total uncompressed ZIP bytes: 2,400 MiB, counted from bytes actually decompressed.
- Maximum image pixels: 40 million, enforced before Sharp processing and passed as `limitInputPixels`.
- Normalized masters: JPEG quality 90, sRGB, EXIF rotation applied, metadata removed.
- Default crop bias: 0.20 toward the top; a synthetic top-marked image is covered by tests.
- Low-photo-resolution warning: effective DPI below 200.

These defaults allow 300 photos of up to 8 MiB each while bounding archive entry count, compressed input, decompressed output, and image decoding. The ZIP itself is spooled to a temporary file for stream inputs; each photo is read, normalized, written, and released before the next photo.

## Dependency audit

- The npm registry `xlsx@0.18.5` was audited and reported two high-severity advisories: SheetJS prototype pollution and ReDoS.
- The registry package was not retained.
- The project now uses the SheetJS-published CDN tarball `xlsx@0.20.3` in the root development dependencies, matching the SheetJS installation guidance.
- Final `npm audit --json`: **0 vulnerabilities**.
- Other added packages: PapaParse, Sharp, Zod, and `yauzl@3.4.0`. The server runtime will need these under `dependencies`: `papaparse`, `sharp`, `xlsx`, `yauzl`, `zod`. Vitest and ESLint remain development tooling.

## Long-name measurement

`LONG_NAME` is only a hint based on a conservative 40-character threshold. It does not claim that a name will fail to fit. Preflight decides real fit using the selected design and the real renderer. This task does not edit `core/` or `content/`.

## Checks

- `npx eslint server/data` — passed.
- `npx vitest run server/data` — **28 passed** after A2b (A2 had 24 focused tests before these fixes).
- A2b benchmark, same 235 JPEGs (1600 × 2200, approximately 2.9 MB each), default limits and no override: before **94.375 s / 2,071.4 MiB RSS**; after **102.984 s / 121.5 MiB RSS**. The after result is below the 600 MiB target.
- Full `npx vitest run` — **143 passed**, **7 suites failed during setup** because the pre-existing `assets/test-logos/logo-1.jpg` asset is missing. No out-of-scope asset was added.
- `git diff --check` — passed.
- `node server/data/demo.js` — ran successfully and printed the summary, first five problem rows, output directory, and unmatched lists without printing names or emails.

## Open questions / known gaps

- `LONG_NAME` is intentionally a preflight hint, not a fit verdict.
- Synthetic photo ZIP data is generated in tests; no large binary fixtures were committed.
- The project-wide baseline failures need the owner of `assets/` to restore the missing test logos/fonts before the full repository suite can be green.

## Suggested commit message

`feat: add deterministic event data and photo pipeline`

## D-38 API contract

Date: 2026-10-20

### Done

- Wrote `docs/API_CONTRACT.md` with one common API error envelope, the REAL
  EventSpec and A2 report shapes/examples, endpoint request/response/error
  coverage, exact export settings, D-09 gating, E2a limits, and PLANNED/open
  questions where server shapes do not exist.
- Rewrote `docs/FRONTEND_NOTES.md` with the one-renderer rule, D-39 QR-toggle
  restriction, D-10 privacy rule, D-12 form fallback, imported-ID rule, A2
  report guidance, and E2a export limits.

### Checks

- `git diff --check` — passed.
- No code or library changes were made. No test suite was run because this
  task changes documents only.

### Half-finished / known gaps

- Project persistence, EventSpec PATCH/lock envelopes, HTTP upload field
  names, draft/render route envelopes, version records, export progress, and
  download transport remain explicitly PLANNED in `docs/API_CONTRACT.md`.

### Single next task

- Implement the server routes against D-38 after the PLANNED request and
  response envelopes are agreed.

### Decision / open question

- D-38 uses the current `core/exportSettings.js` fields, including `mode:
  "sheets"` and nested sheet settings, rather than the older Part 5 example.

### Suggested commit message

`docs: define A2 API contract and frontend boundaries`
