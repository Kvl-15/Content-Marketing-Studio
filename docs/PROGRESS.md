# Progress log

## How to update this file

- After every task, update this file yourself. Do not wait for me to ask.
- Move finished items to Done, with the date and the files involved.
- Keep In progress accurate: what is half-finished, what is known to be broken or unverified.
- Keep Next to the single next task, with one line on why.
- Record any decision made or question left open under Decisions and open questions, with the date.
- Be honest: only mark something Done if its tests pass. Say how you checked.

## Done

- Task GUI-FIX: Preflight Stress-Test Issue Isolation, Stuck Design Button Fix, and Photo-Count Sync (21 October 2026)
  - Files:
    - `client/src/preflightClassification.js`
    - `client/src/preflightClassification.test.js`
    - `client/src/components/ExportWorkflowStep.jsx`
    - `client/src/components/DesignPreviewStep.jsx`
    - `server/storage/schemas.js`
    - `server/storage/schemas.test.js`
    - `docs/API_CONTRACT.md`
    - `docs/PROGRESS.md`
  - Problem Solved:
    - In `ExportWorkflowStep.jsx`, preflight issues read from `selectedVersion.draft.issues` contained synthetic persona notices (such as `NO_PHOTO` on persona `HX26-S-007` generated during composer layout stress testing). This caused the preflight panel to display `NO_PHOTO` warnings and disabled the export button unless the user checked the "acknowledge warnings" box, even when 100% of real attendees had valid photos.
    - In `DesignPreviewStep.jsx`, the design selection button was hardcoded to `isSelected = latestVersion?.draftIndex === index`, causing the button to remain disabled ("✓ Selected") even after regenerating new draft variations or uploading newer attendee photos.
    - The client had no privacy-preserving way to know how many photos were attached in current data vs the saved version snapshot without leaking attendee personal rows.
  - Fix Delivered:
    1. Preflight Issue Classification Helper (`client/src/preflightClassification.js`):
       - `isStressSetIssue()` distinguishes sample persona stress-test issues (`source: "stress-set"`, `HX26-S-00[1-8]`, untagged legacy draft issues) from genuine attendee issues. Real attendee issues (where personId matches current attendee data) are strictly retained.
       - `partitionPreflightIssues()` separates issues into real `attendeeIssues` and non-blocking `stressTestIssues`.
       - `evaluateExportGate()` enables export without requiring an acknowledgement tick when only stress issues exist; requires tick for real warnings; unconditionally blocks export for real errors. Fails safe on bad/malformed input without crashing.
    2. Additive `photoCount` Metric (`server/storage/schemas.js`, `docs/API_CONTRACT.md`):
       - Added integer-only `photoCount` to `toPublicProject` and `toPublicVersion`, counting attendees whose photo is truthy and non-empty. Missing/non-array data returns 0.
       - Preserves full personal data privacy: zero attendee rows, names, or emails are returned in responses.
    3. UI Enhancements:
       - In `ExportWorkflowStep.jsx`: Part (a) displays `"Attendee checks run on the server when you export."` (never invented "All checks passed"). Part (b) presents collapsible stress-test notices. Non-blocking notice displayed when newer photos were uploaded after the selected version was saved. Server 422 errors render code, severity, and nodeId, showing the acknowledgement checkbox only when all server issues are warnings.
       - In `DesignPreviewStep.jsx`: Integrated `getDesignSelectionState()`. Dynamically toggles between `LOCKED` (disabled), `UPDATE_AVAILABLE` (enabled to save Version N+1 with newly uploaded photos), and `NEW_DESIGN` (enabled for fresh drafts or rerolls). Added clear notice on reroll that drafts are previews until selected.
  - Verification:
    - 19/19 tests passing in `client/src/preflightClassification.test.js`.
    - 5/5 tests passing in `server/storage/schemas.test.js`.
    - 23/23 tests passing in `server/server.smoke.test.js`.
    - Client production build succeeds in 1.53s with 0 errors.


- Sanitizer Safety Hardening & ZIP Photo Ingestion (21 October 2026)
  - Files:
    - `server/data/photos.js`
    - `server/data/photos.test.js`
    - `server/routes/photos.js`
    - `server/storage/schemas.js`
    - `server/storage/mongo.js`
    - `server/storage/memory.js`
    - `core/composer.js`
    - `core/picker.js`
    - `core/validate.js`
    - `client/src/components/PhotoUploadStep.jsx`
    - `client/src/components/ExportWorkflowStep.jsx`
    - `server/server.smoke.test.js`
    - `docs/API_CONTRACT.md`
    - `docs/PROGRESS.md`
  - Problem Solved:
    - ZIP photo ingestion failed or reported "unsupported format" due to directory entries (`photos/`) having their trailing slash stripped in `safeZipPath`, non-image text files (`README.txt`) raising `UNSUPPORTED_PHOTO_FORMAT`, and `server/routes/photos.js` looking for `match.id` instead of `match.row?.id`, which left `project.people` with 0 photos attached.
    - The synthetic-role-issue sanitizer introduced during Slice 4 was over-broad (filtering out any issue with `dry-run`, `PREVIEW-`, or `HX26-S-*` regardless of attendee data or role value) and performed write-on-read (`updateOne`) in `mongo.js` `getProject()`.
  - Fix Delivered:
    1. ZIP Photo Ingestion Pipeline Hardening:
       - `safeZipPath()` preserves directory slashes so directory entries (`/\/$/u.test(path)`) are cleanly skipped.
       - Operating system metadata (`__MACOSX/`, `._*`, `.DS_Store`, `Thumbs.db`, `desktop.ini`) is skipped without warnings. Path-traversal checks run strictly before directory/metadata skipping.
       - Harmless non-image text files (`.txt`, `.md`, `.nfo`) are captured in `result.ignoredFiles` and returned in the HTTP upload response as non-blocking notes. Unknown non-image file types (e.g. `.bmp`, `.gif`) continue to be reported as `UNSUPPORTED_PHOTO_FORMAT`.
       - Content magic byte validation: Image format is determined by byte signatures (JPEG, PNG, WebP), not file extension alone. Valid JPEG bytes named `.png` are accepted as JPEG; corrupted data is rejected with `PHOTO_UNSUPPORTED_OR_CORRUPT` without ingestion crashes.
       - Apple CgBI PNG rejection: Detects Apple's proprietary CgBI chunk signature and rejects with explicit error message: `"Apple CgBI-compressed PNG photos are not supported; convert to standard PNG or JPEG"`.
       - Bulk storage write & Version Immutability: In `server/routes/photos.js`, resolved `match.row?.id || match.id` so all matched photos are attached to `project.people` in ONE single storage operation (`storage.addDatasetReport`). Proved that attaching photos does NOT modify saved `versions` snapshots (version snapshots remain completely immutable).
       - Fixture Verification: Tested 215 people vs 216 photos fixture (`attendee_001.png` to `attendee_216.png` matching `attendee_001` through `attendee_215` plus 1 unmatched photo `attendee_216.png` and `README.txt`), verifying 215 matches, 1 unmatched file, 0 unmatched rows, and 215 photos attached in storage.
    2. Strict 4-Point Sanitizer Rule:
       - `isSyntheticStressRoleIssue()` treats an issue as synthetic ONLY when ALL 4 conditions hold:
         1. Issue code is `UNKNOWN_ROLE_ID`.
         2. Person ID matches `HX26-S-00[1-8]`.
         3. Role is `"participant"` or `"organizer"`.
         4. Person ID does not exist in the project's current attendee data (`project.people`).
       - If person ID is `"boss"`, or role is empty `""`, or person ID is a real attendee, or if the issue comes from any other source (or other issue codes), IT IS KEPT.
       - Tagged newly generated stress-set candidate issues at creation time with `source: "stress-set"` in `core/composer.js` and `core/picker.js`.
    3. Strictly Read-Only Storage Access:
       - Removed `updateOne`, `$unset`, and all write-on-read operations from `server/storage/mongo.js` and `server/storage/memory.js` `getProject()`. `getProject()` is strictly read-only.
       - *Note on Production Data:* Earlier code versions may already have rewritten data in Atlas. This change does not run production cleanup against Atlas, leaving existing production records untouched while preventing any future write-on-read mutations.
  - Verification:
    - 21/21 tests passing in `server/data/photos.test.js` (including 215 people vs 216 photos, CgBI rejection, ignored text files, magic byte content detection, empty/generic MIME, invalid ZIP).
    - 23/23 tests passing in `server/server.smoke.test.js` (including bulk photo upload, version immutability verification, 4-point sanitizer test cases 2a-2f, and read-only storage verification).
    - 97/97 tests passing in `core/composer.test.js`, `core/picker.test.js`, `server/export/export.test.js`, and `server/data/data.test.js`.
    - 25/25 client API tests passing in `client/src/api.test.js`.
    - Client production build succeeds in 1.33s (0 errors).
    - ESLint: 0 errors across `server/` and `core/validate.js`.

- Runtime Stale Synthetic Role Issues Sanitizer & GUI Version Switcher Fix (21 October 2026)
  - Files:
    - `server/storage/schemas.js`
    - `server/storage/mongo.js`
    - `server/storage/memory.js`
    - `client/src/components/ExportWorkflowStep.jsx`
    - `server/server.smoke.test.js`
    - `core/composer.js`
    - `docs/PROGRESS.md`
  - Problem Solved:
    - Even after the composer stress-set adaptation was fixed for newly composed drafts, existing projects persisted in MongoDB Atlas (`STORAGE=mongo`) or memory had old `currentDrafts`, `draftIssues`, and saved `versions` containing the 8 synthetic `UNKNOWN_ROLE_ID` errors for `HX26-S-001` through `HX26-S-008` (roles `participant` and `organizer`).
    - In `ExportWorkflowStep.jsx`, preflight errors were evaluated directly from `selectedVersion.draft.issues`. Because the stored version in MongoDB had those 8 synthetic issues, the GUI blocked export with "Export Blocked (Rule D-09): 8 validation error(s) must be resolved", despite all 215 real CSV attendees having 100% valid roles (`participants` and `mentors`).
    - Additionally, `ExportWorkflowStep.jsx` had no version switcher: it hardcoded `selectedVersion = versions[versions.length - 1]`, preventing users from inspecting or switching between saved versions.
  - Fix Delivered:
    1. Automatic Storage Sanitizer (`server/storage/schemas.js`, `mongo.js`, `memory.js`):
       - Added `sanitizeSyntheticRoleIssues()` and `sanitizeProjectIssues()`, which detect and purge synthetic `UNKNOWN_ROLE_ID` errors referencing `HX26-S-*`, `dry-run`, or `PREVIEW-`.
       - In `mongo.js` `getProject(id)`, when a stored project contains synthetic role issues, it sanitizes them in-memory and automatically persists the healed document back to MongoDB (`updateOne`) so Atlas is permanently cleansed.
       - In `mongo.js` and `memory.js` `saveVersion(id, ...)` and `addDrafts(id, ...)`, synthetic issues are filtered before snapshots or drafts are saved.
       - In `toPublicProject()` and `toPublicVersion()`, synthetic issues are stripped from responses returned to clients.
    2. Frontend Preflight Assessment Filter & Version Selector (`client/src/components/ExportWorkflowStep.jsx`):
       - Excluded synthetic stress issues from preflight error/warning counts so stale browser snapshots do not falsely block export. Genuine participant errors on non-synthetic records continue to strictly block export under Rule D-09.
       - Added an interactive Version Selector dropdown in the review card header when `versions.length > 1`, allowing users to choose and verify any saved version snapshot.
    3. Live Database Healing & End-to-End Verification:
       - Executed verification against MongoDB Atlas: project `proj_1792527678094_h0afi5df` ("32-hour coding competition", 215 attendees) was loaded, verified healed, and all 8 `UNKNOWN_ROLE_ID` errors were confirmed permanently removed across drafts and versions (count: 0).
       - Added an end-to-end integration test in `server/server.smoke.test.js` validating custom role IDs (`participants` and `mentors`) from CSV intake through draft composition, version saving, storage healing, print sheet PDF export (200 OK), and strict rejection of unregistered roles (`boss`) with 422.
  - Verification:
    - 14/14 tests passing in `server/server.smoke.test.js`.
    - 15 test files / 257 tests passing in `core/`.
    - 11 test files / 180 tests passing in `server/`.
    - 25/25 client API unit tests passing.
    - Client production build succeeds in 1.38s (0 errors).
    - ESLint: 0 errors across `server/` and `client/`.

- Custom Role ID Resolution & Stress Dataset Role Adaptation Fix (21 October 2026)
  - Files:
    - `core/composer.js`
    - `core/picker.js`
    - `core/render.js`
    - `server/export/exportCard.js`
    - `server/export/exportSheet.js`
    - `server/export/exportBatch.js`
    - `core/composer.test.js`
    - `server/data/data.test.js`
    - `server/routes/drafts.test.js`
    - `server/export/export.test.js`
    - `docs/PROGRESS.md`
  - Problem Solved:
    - When an event is configured with custom role IDs (e.g. `roles: [{ id: "participants" }, { id: "mentors" }]`), CSV import correctly maps and preserves those exact role IDs in `project.people`.
    - However, during draft composition (`composeDrafts`), candidates were evaluated against the static Part 15 stress set (`core/stressSet.js`), whose 8 synthetic records hardcoded `id: "HX26-S-001"` through `"HX26-S-008"` with `roleId: "participant"` and `"organizer"`.
    - Because neither `"participant"` nor `"organizer"` existed in the event's configured roles, `renderCard`'s validator correctly raised `UNKNOWN_ROLE_ID` on all 8 synthetic stress records.
    - These 8 `UNKNOWN_ROLE_ID` errors were collected into `candidate.issues`, attached to each candidate draft, saved into the immutable version snapshot, and subsequently blocked print-ready export at the preflight dashboard with 8 `UNKNOWN_ROLE_ID` errors.
    - Furthermore, `dry-run` card renders in `exportSheet.js`, `exportCard.js`, and `exportBatch.js` hardcoded `roleId: "participant"` as their fallback.
  - Fix Delivered:
    1. Dynamic Role Adaptation for Default Stress Sets (`core/composer.js` & `core/picker.js`):
       - When `composeDrafts` and `createDefaultRunStress` evaluate candidates using the default `stressSet`, the stress test persons dynamically adapt to valid role IDs from `event.roles` (mapping `"organizer"` to the secondary role and `"participant"` to the primary role) if they are not already valid.
       - Caller-provided custom `options.stressSet` datasets remain unmapped, strictly preserving genuine `UNKNOWN_ROLE_ID` error detection when testing bad data.
    2. Dynamic Role Fallbacks in Export Engines:
       - In `server/export/exportCard.js`, `server/export/exportSheet.js`, `server/export/exportBatch.js`, and `core/render.js`, replaced hardcoded `"participant"` dry-run and layout fallbacks with `input.eventSpec?.roles?.[0]?.id || "participant"`.
    3. Comprehensive Regression Tests:
       - `core/composer.test.js`: Verified `composeDrafts` with custom roles `participants` and `mentors` produces 3 drafts with 0 `UNKNOWN_ROLE_ID` errors.
       - `server/data/data.test.js`: Verified CSV import with `name, role, organization` headers and values `participants` and `mentors` imports valid attendees with exact role IDs and without error. Also verified that genuinely unknown role IDs (e.g. `boss`) are rejected.
       - `server/routes/drafts.test.js`: Verified `POST /projects/:id/drafts` for an event with `participants` and `mentors` generates `roleSvgs` for both roles and 0 `UNKNOWN_ROLE_ID` errors.
       - `server/export/export.test.js`: Verified single-card export succeeds for `participants` while rejecting unregistered roles (`boss`) at the D-09 gate.
  - Verification:
    - 33/33 tests passed in `core/composer.test.js`.
    - 18/18 tests passed in `server/data/data.test.js`.
    - 5/5 tests passed in `server/routes/drafts.test.js`.
    - 32/32 tests passed in `server/export/export.test.js`.
    - 13/13 tests passed in `server/server.smoke.test.js`.
    - Full repository test suite: 26 test files, 448 tests passed (0 failures).
    - Client production build: vite built in 1.28s with 0 errors.
    - ESLint: 0 errors on client and server.

- ID Card Review, Preflight Validation & Print-Ready Export Workflow (Slice 4) (21 October 2026)
  - Files:
    - `client/src/api.js`
    - `client/src/components/ExportWorkflowStep.jsx`
    - `client/src/components/ProjectWorkflow.jsx`
    - `client/src/style.css`
    - `client/src/api.test.js`
    - `docs/PROGRESS.md`
  - Features Delivered:
    1. Preflight Validation & Gate Dashboard (`client/src/components/ExportWorkflowStep.jsx`):
       - Directly surfaces server-side Rule D-09 preflight checks. Evaluates candidate issues against the selected immutable version snapshot and attendee dataset.
       - Distinguishes fatal errors (which disable export action) from non-fatal warnings (which require an explicit acknowledgement checkbox: `acknowledgedWarnings: true`).
       - Formats issue labels and messages cleanly, preventing dangling text and preserving transparent issue reporting.
    2. Version Review & Context Display:
       - Displays card specifications: dimensions 54 mm × 85.6 mm (CR80), bleed 3.0 mm, safe margin 3.0 mm, print layout, total participant count, and selected archetype, palette mode, typography, and version snapshot note.
       - Live interactive role switcher tab preview embedded directly in the review step, allowing instant visual inspection of how different participant roles render under the chosen version snapshot.
    3. Production-Ready Export Configuration:
       - Scope selection:
         - Print Sheets (`kind: "sheet"`) for multi-card batch print imposition on A4/A3 paper (PDF and SVG format), with configurable printer safe margin (0–20 mm) and auto crop marks.
         - Individual Card Batch (`kind: "zip"`) streaming all cards in an archive (PDF, SVG, PNG at 300 DPI) with safe unique filenames based on participant IDs.
         - Single Test Card (`kind: "card"`) allowing single-attendee preview proofing (PDF, SVG, PNG) selected via safe participant ID selector.
       - Orientation & sides constraints enforced according to backend rules (portrait front-only).
    4. Robust Binary Download Engine (`client/src/api.js`):
       - `exportProject(projectId, exportSettings)` calls `POST /projects/:id/export` with binary response handling.
       - Extracts clean download filename from `Content-Disposition` header with robust fallbacks.
       - Dispatches browser file downloads using clean `Blob` object URLs with auto-cleanup.
       - Enables "Download Again" directly from the cached blob in memory without triggering duplicate server export requests or re-rendering.
       - Intercepts 422 preflight failures and 409 concurrency lock responses, formatting them into clear user-facing alerts.
    5. Workflow Stepper Integration:
       - Added Step 4 ("Review & Export") to the main workflow stepper in `ProjectWorkflow.jsx`.
       - Provided smooth navigation pills ("Jump to Export" and "Continue to Step 4") in earlier steps once an immutable version is locked.
    6. Verification & Test Suite:
       - Added comprehensive unit tests in `client/src/api.test.js` covering sheet PDF export, batch ZIP export, preflight failure issue parsing, and concurrency 409 handling.
       - All 25 client API unit tests passing.
       - All 4 drafts tests passing.
       - All 13 server smoke tests passing.
       - Full repository test suite passing (26 test files, 443 tests, 0 failures).
       - Client production build succeeds in < 1 second.
       - ESLint: 0 errors across client and server.

- ID Card Design Generation & Preview Workflow (Slice 3) (20 October 2026)
  - Files:
    - `server/routes/drafts.js`
    - `client/src/api.js`
    - `client/src/components/DesignPreviewStep.jsx`
    - `client/src/components/ProjectWorkflow.jsx`
    - `client/src/style.css`
    - `server/routes/drafts.test.js`
    - `client/src/api.test.js`
    - `docs/PROGRESS.md`
  - Features Delivered:
    1. Backend Role Variants & Photo Handling:
       - Enhanced `server/routes/drafts.js` to dynamically generate preview variants in `draft.roleSvgs` for every role defined in `eventSpec.roles`.
       - Resolves matched attendee photos from disk (`os.tmpdir()/acm-studio/<projectId>`) into base64 data URIs (`data:image/jpeg;base64,...`), embedding them directly into `<image>` elements without exposing local filesystem paths.
       - Renders fallback initials avatars for missing photos cleanly without throwing.
       - Enforces strict participant privacy (D-10): uses safe standard preview attendee fixture during draft composition so real participant PII is never stored in public drafts, scene graphs, or returned in `GET /projects/:id`.
    2. Client REST API Wrappers (`client/src/api.js`):
       - `composeProjectDrafts(projectId, options)` -> `POST /projects/:id/drafts`
       - `saveProjectVersion(projectId, { draftIndex, note })` -> `POST /projects/:id/versions`
       - `listProjectVersions(projectId)` -> `GET /projects/:id/versions`
    3. Design Generation, Role Switching & Version Selection UI (`client/src/components/DesignPreviewStep.jsx`):
       - Unlocked only when valid participant data exists (`hasDataset === true`). Gated with clear instructions when dataset is missing.
       - Inviting Empty State with single-click "✦ Generate ID Card Designs" trigger with busy status indicators.
       - Role Switcher tabs dynamically generated from `project.eventSpec.roles` (with color dots and labels, never hardcoding roles), instantly updating vector previews across all designs.
       - 3-Column responsive comparison grid rendering vector SVGs in proper CR80 card aspect ratio (54mm × 85.6mm).
       - Design metadata chips displaying archetype, palette mode, typography, and quality score.
       - Re-roll action ("↻ Generate Different Variations") to generate new designs with fresh seeds.
       - Snapshot selection action calling `POST /projects/:id/versions` with immediate feedback: "✓ Selected (Version N)" badge and confirmation banner.
       - Restores existing drafts and latest chosen version seamlessly when reopening projects via `GET /projects/:id`.
    4. Workflow Integration & Stepper:
       - Integrated Step 3 ("Design & Preview") into the Phase Stepper in `ProjectWorkflow.jsx`.
       - Added smooth scroll jump action to Card Designs.
    5. Verification & Tests:
       - Unit tests in `server/routes/drafts.test.js` (4/4 passed).
       - Unit tests in `client/src/api.test.js` (21/21 passed).
       - Server smoke tests in `server/server.smoke.test.js` (13/13 passed).
       - Full repository test suite: 26 test files, 439 tests passed (0 failures).
       - Client production build: `npm run build --workspace=@acm-studio/client` built in 826ms with 0 errors.
       - ESLint: 0 errors on client and server.

- Photo Upload Gating & Valid Attendee Calculation Fix (20 October 2026)
  - Files:
    - `client/src/components/ProjectWorkflow.jsx`
    - `client/src/components/DataUploadStep.jsx`
    - `client/src/components/A2ReportView.jsx`
    - `client/src/api.test.js`
    - `server/server.smoke.test.js`
    - `docs/PROGRESS.md`
  - Problem Solved:
    - In `ProjectWorkflow.jsx`, `DataUploadStep.jsx`, and `A2ReportView.jsx`, valid attendees were mistakenly determined by checking `report.totals.ok` rather than calculating non-error rows (`totals.rows - totals.errors`).
    - When rows have non-fatal warnings (such as `MISSING_OPTIONAL_FIELD` for `org` or `NO_PHOTO`), the backend assigns `row.status = "WARNING"`, which produces `totals.ok = 0` and `totals.warnings = 5`, even though all 5 attendees were valid and saved in the database (`peopleCount = 5`).
    - This caused `ProjectWorkflow` to never update `peopleCount` upon data upload and kept `hasDataset = false`, locking the photo upload section and falsely displaying *"0 valid attendee records ready for badges"*.
  - Fix Delivered:
    1. Robust Valid Attendee Calculation:
       - Defined `getValidAttendeeCount(report)` as `Math.max(0, rows - errors)` so that non-fatal warnings do not incorrectly disqualify valid attendee rows from badge generation or photo matching.
       - Defined `computeHasDataset(project, report, reportError)` ensuring `hasDataset` resolves to `true` when valid attendees exist and no report error is active.
    2. Dynamic Gating & Project Synchronization:
       - In `ProjectWorkflow.jsx`, immediately propagates `peopleCount` and `datasetReport` to parent state via `onProjectUpdated` upon successful upload (even when rows contain warnings), unlocking photo upload instantly.
       - Added synchronization effect in `ProjectWorkflow.jsx` (`useEffect` on `[project.id, project.datasetReport]`) so reopening saved projects with existing datasets properly restores the unlocked photo upload state from the API response.
       - Corrected UI labels in `DataUploadStep` and KPI cards in `A2ReportView` to accurately report the number of valid attendees ready for badges.
    3. Regression Tests:
       - Added unit tests in `client/src/api.test.js` covering:
         - Successful import with warnings unlocking photo upload and setting valid attendee count.
         - Failed import with 0 valid attendees (HTTP 422) keeping photo upload gated.
         - Reopening saved project restoring unlocked photo upload state immediately.
         - Empty project without dataset keeping photo upload gated.
       - Added assertion in `server/server.smoke.test.js` verifying that `POST /projects/:id/photos` is rejected with `NO_DATASET` before tabular data, and that saved `datasetReport` and `peopleCount: 5` are delivered upon reopening via `GET /projects/:id`.
  - Verification:
    - Client API and workflow tests: 16/16 passed in `client/src/api.test.js`.
    - Server smoke tests: 13/13 passed in `server/server.smoke.test.js`.
    - Data ingestion tests: 16/16 passed in `server/data/data.test.js`.
    - Client production build: `npm run build --workspace=@acm-studio/client` built in 1.17s with 0 errors.
    - ESLint: 0 errors on modified files.

- CSV Header Auto-Mapping & Diagnostic Report Fix (20 October 2026)
  - Files:
    - `server/data/headers.js`
    - `client/src/components/A2ReportView.jsx`
    - `server/data/data.test.js`
    - `server/server.smoke.test.js`
    - `docs/PROGRESS.md`
  - Problem Solved:
    - In `server/data/headers.js`, `mappingProposal` grouped all candidates across columns by target, causing lower-confidence secondary candidate matches (e.g. `participant_id` matching `name` alias at 0.719 confidence via substring) to incorrectly treat target `name` as competing even though column 0 had an unambiguous 100% confidence match.
    - When `proposal.mapping` dropped `name`, ingestion extracted blank attendee names, causing all rows to fail with `MISSING_NAME` (0 valid attendees, HTTP 422).
    - In `client/src/components/A2ReportView.jsx`, issues without a value rendered dangling text like `(org: )`.
  - Fix Delivered:
    1. Automatic Header Mapping:
       - Refined `mappingProposal` in `server/data/headers.js` to distinguish primary candidates (`isTop`) from secondary candidates.
       - A lower-confidence secondary candidate from another column does not invalidate an unambiguous primary match with higher confidence.
       - Confirmed `name`, `role`, `participant_id` maps cleanly to `{ name: 0, roleId: 1, id: 2 }` with empty `competing`.
       - Genuine ambiguity (e.g. `["Full Name", "Display Name"]`) is preserved and correctly reported in `competing`.
    2. Diagnostic Report View:
       - Enhanced `A2ReportView.jsx` to render clear labels like `Missing optional field: org` for `MISSING_OPTIONAL_FIELD` notices.
       - Suppressed dangling field colons `(org: )` when no issue value is present.
    3. Regression Tests:
       - Added unit tests in `server/data/data.test.js` covering `['name', 'role', 'participant_id']` mapping proposal, preservation of genuine ambiguity in competing fields, and end-to-end dataset creation with auto-proposed mapping.
       - Added an integration smoke test in `server/server.smoke.test.js` verifying `POST /projects/:id/data` returns HTTP 200 with 5 valid attendees.
  - Verification:
    - Vitest unit tests: 16/16 passed in `server/data/data.test.js`.
    - Server smoke tests: 13/13 passed in `server/server.smoke.test.js`.
    - Client API tests: 12/12 passed in `client/src/api.test.js`.
    - Full project test suite: 25 test files, 426 tests passed (0 failures).
    - Client build: `npm run build --workspace=@acm-studio/client` built in 1.47s with 0 errors.
    - ESLint: 0 errors on modified files.

- Slice 2 Navigation & Post-Lock UX Fix (20 October 2026)
  - Files:
    - `client/src/components/ReviewStep.jsx`
    - `client/src/components/ProjectWorkflow.jsx`
    - `client/src/components/DataUploadStep.jsx`
    - `client/src/App.jsx`
    - `client/src/style.css`
    - `docs/PROGRESS.md`
  - Improvements Delivered:
    1. Post-Lock UX & Explicit Transition:
       - Locking the EventSpec reveals a green lock confirmation banner and a prominent primary button directly in the bottom action bar: "Continue to Create Project →".
       - Clicking "Continue to Create Project →" cleanly transitions to a dedicated Project Creation view, removing confusing off-screen inline insertions.
       - The dedicated Project Creation view features a summary callout of the locked event, an easy return route ("← Return to Locked Specification"), project name and optional event code fields, and duplicate submission prevention.
    2. React Effect Scroll Resets:
       - Configured an idiomatic React `useEffect` in `App.jsx` watching `[view, activeProject?.id]` and in `ProjectWorkflow.jsx` to reset scroll to top (`window.scrollTo({ top: 0, behavior: "instant" })`) upon view transitions, newly created projects, and projects reopened from the Dashboard.
    3. Auto-Scroll & 422 Diagnostic Handling:
       - After successful data upload, smoothly auto-scrolls the view directly to the A2 Report.
       - When data upload fails with HTTP 422 (e.g. zero valid participants), surfaces the server's diagnostic report and row issues alongside an error banner, never discarding validation errors.
       - Added a "Continue to Step 2: Photo Upload ↓" action at the bottom of the A2 Report for smooth sequential progression.
    4. Workflow Phase Stepper:
       - Added visual status pills at the top of the workflow indicating progress for Step 1 (Participant Data) and Step 2 (Attendee Photos), with explicit gating until participant data exists.
  - Verification:
    - 12 unit tests passing in `client/src/api.test.js`.
    - Vite production build passing in 2.15s (`npm run build --workspace=@acm-studio/client`).
    - ESLint passing with 0 errors and 0 warnings (`npx eslint client/src/`).

- Frontend Slice 2: Project Dashboard, Creation, and Data/Photo Upload (20 October 2026)
  - Files:
    - `client/src/api.js`, `client/src/api.test.js`
    - `client/src/App.jsx`
    - `client/src/components/ProjectDashboard.jsx`
    - `client/src/components/ReviewStep.jsx`
    - `client/src/components/ProjectWorkflow.jsx`
    - `client/src/components/DataUploadStep.jsx`
    - `client/src/components/A2ReportView.jsx`
    - `client/src/components/PhotoUploadStep.jsx`
    - `client/src/style.css`
    - `docs/PROGRESS.md`
  - Features Delivered:
    1. Project Dashboard:
       - Connects to `GET /projects` listing saved projects with ID, name, event code, timestamps, and empty/loading/error states.
       - Opens existing projects directly by loading full project details via `GET /projects/:id`.
    2. Project Creation from Locked EventSpec:
       - Seamlessly bridges Step 3 (Review & Lock) to project creation without dead ends.
       - Invokes `POST /projects` with name, eventSpec, and optional validated `eventCode` (2-8 uppercase alphanumeric).
       - Duplicate submission protection with busy states.
    3. Tabular Data Upload:
       - Accepts raw file bytes (CSV, XLSX, JSON) via `POST /projects/:id/data`.
       - Supports drag-and-drop, format detection, and clear error handling (400, 413, 422).
    4. A2 Data Report Screen:
       - Displays actual server validation report: KPI summary tiles (total, valid, warnings, errors, formula-like cells), file/ingestion metadata, proposed column mapping with confidence bars, and row diagnostics with severity filtering.
       - On HTTP 422 (zero valid participants), surfaces the report diagnostic rows so users see exact issues.
    5. Photo ZIP Archive Upload & Matching:
       - Accepts raw ZIP bytes via `POST /projects/:id/photos` with 300 MB limit and dataset gating.
       - Displays photo matching results: matched participants table, unmatched files list, unmatched rows list, and warnings.
    6. Preserved Intake Flow & Polished Cohesive Dev-Tool UI:
       - Fully preserved Brief -> Questions -> Review & Lock wizard.
       - Clean navigation tabs (Dashboard, Intake Spec, Active Project), semantic styling, accessible focus states, and zero third-party UI libraries.
  - Verification:
    - 12 unit tests passing in `client/src/api.test.js`.
    - Vite production build passing cleanly in 1.50s (`npm run build --workspace=@acm-studio/client`).
    - ESLint passing with 0 errors and 0 warnings (`npx eslint client/src/`).
    - 424 backend and core tests passing in Vitest.

- Task G: Gemini Gateway Speed, Bounded Deadlines and Model Fix (20 October 2026)
  - Files:
    - `server/ai/gateway.js`, `server/ai/gateway.test.js`
    - `scripts/intake-demo.js`
    - `.env.example`
    - `docs/API_CONTRACT.md`
    - `docs/PROGRESS.md`
  - Replaced wrong model name `gemini-3.8-flash` with `gemini-3-flash-preview` across all files (`gateway.js`, `.env.example`, `API_CONTRACT.md`, `scripts/intake-demo.js`, tests). Verified zero mentions of `3.8-flash` remain in project files.
  - Thinking level:
    - Added `generationConfig.thinkingConfig.thinkingLevel = "low"` by default, configurable via `GEMINI_THINKING_LEVEL` (`minimal`, `low`, `medium`, `high`, or empty string `""` to omit `thinkingConfig`).
    - Invalid values fall back to `"low"` with a privacy-safe console log line that omits the raw value and any secrets.
  - Thinking fallback:
    - On HTTP 400 with response text mentioning `"thinking"`, retries once without `thinkingConfig`. This retry does not count against normal attempts. Non-thinking 400 errors fail immediately without retry.
  - Bounded execution & time limits:
    - Enforced an overall 35,000 ms deadline for `parseBrief` (`options.totalDeadlineMs`), with `Math.min(15000, timeLeft)` per attempt timeout (`options.timeoutMs`).
    - At most 2 normal attempts. Abort signal terminates hanging requests. Fails closed with 422 `BRIEF_PARSE_FAILED` or `AI_UNAVAILABLE` and `emptySpec` (D-12).
  - Privacy-safe logging (D-10):
    - Logs brief length, outcome, attempts, and elapsed ms only (`[AI Intake] brief length: N, outcome: ok|retry|failed, attempts: A, elapsed: Tms`). Never logs brief text, API key, or response bodies.
  - Demo CLI update:
    - `scripts/intake-demo.js` prints model name, thinking level used, attempts, elapsed ms, and outcome without logging brief text, keys, or response bodies.
  - Verification:
    - 47 tests passed across `server/ai` and `server/intake` (`npx vitest run server/ai server/intake`).
    - ESLint clean (0 errors, 0 warnings) on `npx eslint server/ai scripts/intake-demo.js`.
    - No real API calls made in automated tests.

- Task I: Intake Logic + Gemini Gateway (20 October 2026)
  - Files:
    - `server/intake/emptySpec.js`, `server/intake/gaps.js`, `server/intake/questions.js`, `server/intake/applyAnswer.js`, `server/intake/lockSpec.js`, `server/intake/index.js`, `server/intake/intake.test.js`, `server/intake/routes.test.js`
    - `server/ai/gateway.js`, `server/ai/gateway.test.js`
    - `server/routes/intake.js`, `server/app.js`
    - `scripts/intake-demo.js`
    - `.env.example`, `docs/API_CONTRACT.md`, `docs/PROGRESS.md`
  - Implemented pure intake module in `server/intake/` (zero network, no `Date.now()`, no `Math.random()`):
    - `emptySpec(designType)` creates initial scaffold with "unknown" statuses and CR80 portrait defaults.
    - `findGaps(spec)` performs 4-group gap analysis per KB 7.3 (required, defaulted, optional, derived). Values with status `"suggestion"` or unconfirmed source `"suggestion"` count as gaps (D-13). Declined fields do not count as gaps. Real calendar date validation checks valid year/month/day with leap years.
    - `nextQuestions(spec, declined)` presents 3 to 5 questions in 2 or 3 steps from question bank. Declined values never asked again. Follows D-39 strictly: no QR questions, no photo questions, no landscape or back side questions.
    - `applyAnswer(spec, answer)` deep clones and applies user answers immutably. Supports `{ path, action: "confirm" | "decline" }` to accept or decline prefilled brief values without retyping. Converts role IDs to lowercase slugs. Derives default role colors spaced by >= 15% in lightness. Validates real calendar dates. Blocks landscape, back sides, and QR toggle.
    - `lockSpec(spec)` validates against full Zod `EventSpec`, ensures zero required gaps and zero unconfirmed suggestions, and returns a frozen immutable spec. One-line rule: A spec is locked only if it satisfies EventSpec, has zero required gaps, and contains zero unconfirmed suggestions.
  - Implemented AI Gateway in `server/ai/gateway.js`:
    - Plain native Node `fetch` (JSON mode) calling Gemini REST API with zero external SDKs.
    - Enforces D-02 hard zero-invention rule, derives prompt with schema, today's date parameter, and brief text.
    - Keyword detection for `designType` ("id-card"); leaves unset if unknown.
    - Evidence check (KB 7.1 step 4) checks all 7 fields (`name`, `venue`, `tagline`, `dates`, `roles`, `palette`, `fields`) and discards any untraced dates, roles, taglines, made-up names/venues, or colors. Surviving values marked `status: "provided"`, `source: "brief"`, `confirmed: false`. Counts like "200 participants" fill `roles[].expectedCount` only.
    - On failure, retries once with validation error appended; on second failure returns 422 with `BRIEF_PARSE_FAILED` and `emptySpec` for immediate form fallback (D-12, KB 7.1 step 3).
    - Privacy & Logging (KB 7.7, D-10): Logs brief length and outcome only (`[AI Intake] brief length: N, outcome: ok|retry|failed`). Never logs brief text, never logs or returns API keys, and never sends participant names, emails, or photos to AI. D-10 privacy unit test proves fake participant names and emails never reach the payload.
  - Implemented 4 Express Routes in `server/routes/intake.js` mounted in `server/app.js`:
    - `POST /intake/parse` (extracts brief into EventSpec scaffold or returns 422 with emptySpec fallback).
    - `POST /intake/questions` (returns next questions alongside the 4 gap groups and `hasRequiredGaps`).
    - `POST /intake/answer` (applies answers or confirms/declines prefilled fields).
    - `POST /intake/lock` (validates and freezes locked EventSpec).
  - Created standalone CLI demo: `scripts/intake-demo.js` working with `node --env-file=.env`.
  - Testing & Verification:
    - 42 tests across 3 test suites (`server/intake/intake.test.js`, `server/intake/routes.test.js`, `server/ai/gateway.test.js`) passing 100% via `npx vitest run server/intake server/ai`.

- Task S: Server + MongoDB / In-Memory Storage & REST API (20 October 2026)
  - Files:
    - `server/app.js`, `server/cors.js`, `server/assets.js`
    - `server/routes/health.js`, `projects.js`, `data.js`, `photos.js`, `drafts.js`, `versions.js`, `export.js`, `index.js`
    - `server/storage/index.js`, `schemas.js`, `memory.js`, `mongo.js`
    - `scripts/serve.js`
    - `server/server.smoke.test.js`
    - `.env.example`, `package.json`, `package-lock.json`
    - `docs/API_CONTRACT.md`, `docs/PROGRESS.md`
  - Implemented dual storage backend (MongoDB via Mongoose and In-Memory fallback), selectable via `STORAGE=mongo|memory` (defaulting to memory with a clear log line when `MONGODB_URI` is unset). `MONGODB_URI` is never logged or printed.
  - Zero third-party CORS package: hand-rolled middleware in `server/cors.js` allowing only `http://localhost:5173`, `http://localhost:3000`, and `ALLOWED_ORIGINS` env var.
  - Asset preloader (`server/assets.js`): static TTF fonts and brand-kit logos are loaded from disk once on server startup; client cannot supply arbitrary file paths.
  - Where people live & privacy:
    - Exactly stored fields for cleaned people: `id`, `name`, `roleId`, `org`, `email`, `photo`, `checkinUrl`, `flags`.
    - Names and emails are strictly personal data: never logged, never returned in API responses (client receives only the A2 dataset report), and never included in error bodies.
    - Photos are stored exclusively on disk under `os.tmpdir()/acm-studio/<projectId>/` and streamed on-demand via `photoSource(personId)`. Deleting a project deletes its disk photo folder.
  - Long exports & Concurrency:
    - All export formats supported: single-card SVG, PNG, PDF; A4 sheet PDF; batch ZIP archive. All generated from saved version snapshots with D-09 preflight gating.
    - Concurrency lock: strictly 1 export per project at a time; second simultaneous request receives 409 `EXPORT_IN_PROGRESS`.
    - Server timeouts: `requestTimeout` set to 10 minutes (600,000 ms), `headersTimeout` set to 10 min + 5 s.
    - Client disconnect safety: on request abort, Chromium browser instances are automatically closed.
    - TODO: Export progress polling endpoint deferred to future work.
  - Manual MongoDB verification (3-line check):
    ```bash
    STORAGE=mongo MONGODB_URI=mongodb://localhost:27017/acm-studio node scripts/serve.js &
    curl -s http://localhost:3000/health | grep '"storage":"mongo"'
    kill %1
    ```
  - Full smoke test suite (`server/server.smoke.test.js`) passes 10/10 tests via native Node `fetch` on ephemeral port `app.listen(0)`.


- Task 1: Schemas (16 October 2026)
  - Files: `core/schemas.js`, `core/fixtures.js`, `core/schemas.test.js`.
  - 39 tests passed verifying all 12 schemas against good and bad inputs.
- Task 2: Stub core API (16 October 2026)
  - Files: `core/render.js`, `core/validate.js`, `core/operations.js`, `core/picker.js`, `core/index.js`, `core/stubs.test.js`.
  - Stubbed `renderCard`, `validate`, `applyOperation`, `pickThree`.
  - 3 stub unit tests passed.
- Task 3: First real vertical slice of renderCard (16 October 2026)
  - Files: `core/templateData.js`, `core/render.js`, `core/renderCard.test.js`, `scripts/preview-card.js`.
  - Implemented template data for portrait skeleton, blocks, theme, and look.bold.
  - Rendered scene nodes and SVG with role resolution, XML escaping, and logo/photo placeholders.
  - 6 unit tests passed in `core/renderCard.test.js`.
- Task 4: Text measuring, wrapping and fitting (17 October 2026)
  - Files: `core/text.js`, `core/render.js`, `core/schemas.js`, `core/templateData.js`, `core/index.js`, `core/text.test.js`, `core/renderCard.test.js`, `scripts/preview-card.js`.
  - Implemented `measure`, `wrap`, and `fitText` following D-20 with `opentype.js`.
  - Added optional `oneLineFloor` field to `TextBlockElement` schema with range refinement.
  - Emitted multi-line SVG text with vertical centering and `TEXT_TRUNCATED` warning issues.
  - 65 tests passed across 5 test files (`npx vitest run`).
- Task 5: The Validator (17 October 2026)
  - Files: `core/validate.js`, `core/validate.test.js`, `core/render.js`, `core/templateData.js`, `core/schemas.js`, `core/schemas.test.js`, `core/index.js`.
  - Implemented pure validator with all checks (Part 11.1 table and D-09 severities).
  - Added optional `decor` flag to block elements and scene nodes; `OVERLAP` checks content elements only.
  - Shared `LINE_HEIGHT` constant (1.25) across renderer and validator.
  - Added WCAG 2.1 contrast calculation (4.5:1 / 3:1 for large text), safe margin verification, placeholder checks, font re-measuring for overflow, and logo/QR validation.
  - 103 tests passed across 6 test files (`npx vitest run`).

- Task 6: Autofix (18 October 2026)
  - Files: `core/autofix.js`, `core/autofix.test.js`, `core/render.js`, `core/schemas.js`, `core/index.js`.
  - Implemented pure bounded autofix pipeline in Part 11 order: (a) text size reduction within D-22 floor, (b) hiding optional elements (`optional: true`), (c) text color contrast fix (`#FFFFFF`/`#111827`), (d) compact density stub.
  - Wired into `renderCard` with additive `fixes` list; rollback if repairs do not reduce errors or introduce new ones.
  - 116 tests passed across 7 test files (`npx vitest run`).

- Task 7A: Content decoupled into JSON files (18 October 2026)
  - Files: `content/skeletons/portrait.json`, `content/blocks/*.json`, `content/themes/brand-blue.json`, `content/looks/look.bold.json`, `content/brand-kits/acm-nitsurat/brand.json`, `scripts/loadContent.js`, `core/templateData.js`, `core/content.test.js`, `docs/ADDING_CONTENT.md`, `core/golden/*.svg`.
  - Moved template definitions from hardcoded JavaScript in `core/templateData.js` into modular JSON files in `content/`.
  - Implemented schema-validating loader `scripts/loadContent.js`.
  - Golden SVG tests confirmed byte-identical output for `personNormal` and `personLongName`.
  - Added `docs/ADDING_CONTENT.md` guide and updated `docs/AGENT_RULES.md` for Person A covering Person C's areas.
  - 124 tests passed across 8 test files (`npx vitest run`).

- Task 7B: 6-Look Library, Theme Derivation & Distinctness (18 October 2026)
  - Files: `core/themeDerivation.js`, `core/render.js`, `core/schemas.js`, `core/index.js`, `core/content.test.js`, `content/skeletons/*.json`, `content/blocks/*.json`, `content/themes/*.json`, `content/looks/*.json`, `content/compatibility.json`, `scripts/loadContent.js`, `scripts/preview-gallery.js`, `docs/ADDING_CONTENT.md`.
  - Authored clean, distinct 6-look design library (Minimal, Bold, Tech, Formal, Playful, Editorial) adhering to 3 mm safe margins and 1/2/3/4 mm spacing grid across 3 skeletons, 5 headers, and 3 role markers.
  - Implemented pure-code theme derivation (`core/themeDerivation.js`) deriving light, dark, and colour-field themes from 1 to 3 event colors with guaranteed WCAG 2.1 contrast (D-24).
  - Enforced distinctness guarantee (D-25): pairwise distance >= 5 across two disjoint groups of 3 looks.
  - Golden SVG tests confirmed byte-identical output for `look.bold` with reference palette.
  - Stress test passed: 3,600 renders (6 looks x 200 random palettes x 3 persons) with zero validator errors.
  - Generated visual HTML gallery (`scripts/preview-gallery.js` -> `gallery.html`).
  - 128 tests passed across 8 test files (`npx vitest run`).

- Task 7C: Real Logo Images & Gallery Verification (18 October 2026)
  - Files: `assets/test-logos/`, `content/brand-kits/test-logos/brand.json`, `scripts/loadContent.js`, `core/render.js`, `core/schemas.js`, `scripts/preview-gallery.js`, `core/logos.test.js`, `.gitignore`.
  - Added pure-JS zero-dependency binary header reader for PNG and JPEG image dimensions and base64 data-URI encoder in `scripts/loadContent.js` with >500 KB size warnings.
  - Implemented proportional contain-fit scaling and anchoring for real logo images in `core/render.js`, emitting SVG `<image>` tags.
  - Preserved fallback gray rectangle placeholders for omitted logos; golden SVG regression tests remain byte-identical.
  - Integrated validator checks (`LOGO_DISTORTED`, `LOGO_TOO_SMALL`, `LOGO_MISSING`, `LOGO_CLEARSPACE`) for real image nodes.
  - Updated `scripts/preview-gallery.js` to render with `test-logos` by default (with `--placeholder` CLI flag available).
  - Added 10 comprehensive unit/stress tests in `core/logos.test.js` (aspect ratio matching within 0.5% for 4:1, 1:1, 1:3; contain-fit shrink without cropping; missing file error handling; stress testing with test logos).
  - 138 tests passed across 9 test files (`npx vitest run`).

- Task D1: Rendering Foundations (18 October 2026)
  - Files: `core/render.js`, `core/text.js`, `core/validate.js`, `core/schemas.js`, `content/blocks/header.*.json`, `scripts/preview-gallery.js`, `core/golden/*.svg`, `core/d1.test.js`, `docs/ADDING_CONTENT.md`, `docs/PROGRESS.md`.
  - Emitted all SVG text as vector path outlines using `opentype.js` wrapped in `<g id="..." aria-label="...">` (zero `<text>` or `font-family` in output).
  - Added validator check `TEXT_UNSUPPORTED_GLYPH` (severity Error) for missing font characters (glyph index 0).
  - Implemented automatic logo background plates (`plate: "auto"` / `{ fill, radiusMm, paddingMm }`) on dark/saturated backgrounds (<0.9 lightness).
  - Added fallback photo placeholders: neutral silhouette for missing photo files and initials avatar for `photo: null` with `NO_PHOTO` warning.
  - Enhanced preview gallery with scaled 3.18 mm rounded corners and drop shadow.
  - 147 tests passed across 10 test files (`npx vitest run`).

- Task 8: The Picker (18 October 2026)
  - Files: `core/picker.js`, `core/stressSet.js`, `core/picker.test.js`, `core/stubs.test.js`, `core/index.js`, `scripts/preview-drafts.js`, `.gitignore`, `docs/PROGRESS.md`.
  - Implemented Spec 9.2 distance metric, Spec 9.6 distinctness preference (every pair >= 5), deterministic tie-breaking, and AI style hint scoring (+3 per matching look).
  - Implemented `filterEligible` matching requirements (orientation, maxRoles, needsPhotoSlot) and compatibility rules with plain UI reasons.
  - Implemented Part 15 `stressSet` covering edge cases (short names, 57-char names, 28-letter words, accents/entities, long org/roles, null photos, empty optional fields).
  - Implemented `draftsFor` with candidate triplet evaluation, stress testing, dropping/replacement of failing looks, and edge case notes.
  - Built side-by-side draft generator `scripts/preview-drafts.js` emitting `drafts.html`.
  - 161 tests passed across 11 test files (`npx vitest run`).

- Spike C1 + C2: Dynamic Look Composition & Quality Scorer Spike (18 October 2026)
  - Files: `core/composer.js`, `core/composer.test.js`, `core/schemas.js`, `core/index.js`, `scripts/preview-drafts.js`, `drafts.html`.
  - Implemented parameterised generator pipeline `compose(event, seed)` with 4 archetypes (`hero-photo-top`, `colour-block-split`, `circle-badge-centre`, `typographic-name-first`).
  - Added deterministic draft selector `composeDrafts(event, { seed, count, previousArchetypes, previousSeeds })` selecting distinct archetypes or parameter-diverse variants (distance >= 5).
  - Implemented unit-tested quality scorer `scoreQuality(look, scene, context)` measuring name-to-role ratio (>= 1.6), whitespace share (25-55%), distinct alignment axes (left, center, right, awarding full points for single center axis), and WCAG contrast margin.
  - Implemented SVG vector placeholder avatars and grayscale mode toggle in `scripts/preview-drafts.js` -> `drafts.html`.
  - 172 tests passed across 12 test files (`npx vitest run`).

- Task C2b: Composer Fix Round (18 October 2026)
  - Files: `core/composer.js`, `core/composer.test.js`, `core/render.js`, `core/schemas.js`, `scripts/preview-drafts.js`, `drafts.html`.
  - What was fixed:
    - Palette usage: Corrected call order in `deriveTheme(palette, mode)` and bound fills/accents to theme colors; test proves 10 events produce 10 distinct dominant colors matching their palettes.
    - Draft distinctness: Triplet selection enforces 3 distinct archetypes, 3 different modes (light, dark, colour-field with automatic fallback), and varied typography.
    - Content completeness: Cards display event name, both logos (~12mm wide), person name, org, role pill, ID line, and role edge bar (>= 3mm). Missing optional fields close gaps without dead space.
    - Hierarchy: Hero name 15-16 pt bold heading; role text >= 7 pt bold caps; real rendered mm ratio >= 2.0x in scorer.
    - Role differentiation & grayscale contrast: Default role colors feature 4 lightness steps >= 15% apart (Volunteer 86%, Participant 68%, Organizer 44%, Mentor 17%) with role edge bars.
    - Bug fixes: `<clipPath>` for circle/rounded image elements (no poking square corners); removed intersecting line in circle badge; refined logo plate backgrounds.
    - Quality scorer: Reworked into a discriminating 0-100 metric (spread >= 25 points) penalizing empty space > 45% and rewarding palette utilization.
    - 175 tests passed across 12 test files (`npx vitest run`).
  - What is still weak:
    - Still using single default font (`Roboto-VariableFont`) until static TTF font pairs (Space Grotesk + Inter, Fraunces + Source Sans 3) are approved.
    - Two-sided card layout support is deferred.
    - Photo resolution checks deferred to preflight.

- Task C2c: Composer Fix Round 2 & Rendering Refinements (18 October 2026)
  - Files: `core/composer.js`, `core/composer.test.js`, `core/render.js`, `core/schemas.js`, `core/autofix.js`, `core/themeDerivation.js`, `scripts/preview-drafts.js`, `drafts.html`.
  - What was fixed:
    1. Event Name: Never truncated; wraps across 2 lines or shrinks down to 6 pt floor in uppercase. If still overflowing, hidden cleanly with preflight `EVENT_NAME_DOES_NOT_FIT` warning. Tested with 40-character and 200-character event names. Guaranteed >= 4.5:1 contrast against its background band.
    2. Shared Logo Plate: Added `plate: "shared"` to schema and renderer. Replaced two separate white boxes with ONE shared white rounded plate (1 mm padding, 1.5 mm radius) spanning both logos (each scaled contain-fit to >= 12 mm wide, filling height). On near-white backgrounds (L >= 0.88), no plate is drawn. Backwards compatibility preserved for frozen Task D1 templates (`plate: "auto"`).
    3. Dark & Colour-Field Modes: Dark mode background hue derived directly from event palette's darkest colour / darkened primary (clamped to 0.08-0.14 lightness keeping saturation), not a fixed navy. Quality scorer caps total at 60 if palette score is 0. Triplet selection guarantees 3 distinct modes (light, dark, colour-field).
    4. Role Pill Contrast & Grayscale Distinctness: Role pill contrast check prefers a 0.6 mm high-contrast outline (`#FFFFFF` or `#111827`, strokeWidth 0.6) when contrast < 3.0:1, with fill inversion as fallback. Role pill boxes resized to >= 28 mm wide x 6 mm tall with >= 7 pt bold caps text. Tested in grayscale: all 4 default roles (Volunteer 86%, Participant 68%, Organizer 44%, Mentor 17%) maintain >= 15% lightness difference on both light and dark cards on final pill and edge bar.
    5. QR Placeholder & Priority Drop Order: Rendered clean labelled placeholder box (text "QR", exact size) without external libraries. Crowded space drop priority: QR first, then org, then ID line; never drop name, role, or logos.
    6. Gallery & Tests: Added Section 5 in `drafts.html` showcasing before/after of the shared logo plate and light background behavior.
    7. Static TTF Font Pairings: Added verified static TTF font files and license texts to `assets/fonts/`:
       - Pair 1 (Modern Grotesk): Space Grotesk Bold (`SpaceGrotesk-Bold.ttf`, 116 KB) + Inter Regular (`Inter-Regular.ttf`, 411 KB).
       - Pair 2 (Editorial Serif): Source Serif 4 Bold (`SourceSerif4-Bold.ttf`, 271 KB) + Source Sans 3 Regular (`SourceSans3-Regular.ttf`, 431 KB), replacing variable-only Fraunces per approved proposal.
       - Wired `FONT_PAIRINGS` into `core/composer.js` (sampling `typography` and assigning `theme.fonts`) and `scripts/preview-drafts.js` (rendering real paired fonts into `drafts.html`).
       - Added test `(r)` in `core/composer.test.js`.
    - 180 tests passed across 12 test files (`npx vitest run`).
  - Decisions recorded:
    - Added `EVENT_NAME_DOES_NOT_FIT` to `IssueCode`.
    - Added `plate: "shared"` to `ImageBlockElement` and `ImageNode`.
    - Added `stroke` and `strokeWidth` to `RectBlockElement` and `RectNode`.
    - Approved font pairing replacements: Source Serif 4 + Source Sans 3 as the static editorial pairing.

- Task E1: Export settings schema and print-sheet layout (pure code) (19 October 2026)
  - Files: `core/exportSettings.js`, `core/sheet.js`, `core/sheet.test.js`, `core/index.js`, `scripts/preview-sheet.js`, `docs/PROGRESS.md`.
  - 22 unit tests passed in `core/sheet.test.js` (total 202 tests passing across 13 test files via `npx vitest run`).
  - The 8-vs-9 card finding:
    - KB 13.3 & 16.1 assumed a landscape CR80 card (85.6 mm wide x 54 mm tall, with 3 mm bleed yielding 91.6 x 60 mm cells), calculating 2 cols x 4 rows = 8 cards on A4.
    - Our event cards are portrait CR80 (54 mm wide x 85.6 mm tall, with 3 mm bleed yielding 60 x 91.6 mm cells). With 5 mm margin and 4 mm gap, this fits 3 cols x 3 rows = 9 cards per page on A4 (actual margins: 11.0 mm X, 7.1 mm Y).
  - Chosen defaults and rationale:
    - `paper`: "A4" (210 x 297 mm international standard).
    - `card`: 54 x 85.6 mm (portrait CR80).
    - `bleedMm`: 3 mm (creates 60 x 91.6 mm cells).
    - `marginMm`: 5 mm (enables full 3x3 imposition on A4).
    - `gapMm`: 4 mm (guarantees space between bleed boxes so vector crop marks never overlap or enter bleed).
    - `cropMarks`: true for sheets mode (false otherwise).
    - `markLengthMm`: 2 mm; `markOffsetMm`: 3 mm (starts exactly at bleed edge, reaches 5 mm from trim; adjacent marks meet at center across 10 mm trim-to-trim distance without collision).
    - `markStrokeMm`: 0.35 mm (print-safe, >= 0.3 mm).
  - Features delivered:
    - Zod schema `ExportSettings` with strict rejection of NaN, Infinity, negative, zero, extra keys, and unknown enums.
    - `parseExportSettings` applying paper dimensions, auto-swapping dimensions on landscape orientation, and resolving crop mark defaults.
    - Pure `sheetLayout` returning pages, cells (with `xMm`, `yMm`, `trimBox`, `bleedBox`), and deduplicated vector crop marks.
    - Duplex support: mirrors column order on back pages ($c_{\text{back}} = \text{cols} - 1 - c$) so front and back cards align.
    - Role grouping (`groupByRole`): cards of the same role stay together; partly filled last pages do not mix roles.
    - `printerSafeMm`: Configurable minimum distance (0 to 20 mm, default 5 mm). Warns with `MARKS_NEAR_PAGE_EDGE` if any crop mark or bleed box is closer than `printerSafeMm` to a page edge. On default A4, real smallest distance is 5.1 mm (top and bottom crop mark tips).
    - `duplexFlip`: `"long" | "short"` (default `"long"`). `"long"` mirrors columns ($c_{\text{back}} = \text{cols} - 1 - c$); `"short"` mirrors rows ($r_{\text{back}} = \text{rows} - 1 - r$).
    - `MARK_OFFSET_BELOW_BLEED`: Warns when `markOffsetMm < bleedMm` so crop marks do not start inside the bleed area.
    - Separate unit tests in `core/exportSettings.test.js` (NaN, Infinity, negatives, extra keys, unknown enums, dpi 71/1201, bleedMm 11, custom paper without dimensions, landscape swap, and A3 layout with 16 cards/page arithmetic).
    - Visual preview script `scripts/preview-sheet.js` generating `sheet-preview.html` with unitless SVG numbers, interactive badge toggle, fixed role fixture, and strict assertion verifying card label matches role.
  - 215 tests passed across 14 test files (`npx vitest run`).

- Task R1: Unknown role must be an error, never a silent default (19 October 2026)
  - Files: `core/schemas.js`, `core/render.js`, `core/validate.js`, `core/composer.js`, `core/fixtures.js`, `core/validate.test.js`, `core/renderCard.test.js`, `core/composer.test.js`, `scripts/preview-sheet.js`, `scripts/preview-unknown-role.js`.
  - Removed silent fallbacks in `core/render.js` ("PARTICIPANT" and default blue `#2563EB`).
  - Unresolvable role now renders neutral slate-gray `#6B7280` pill/bar with text `"UNKNOWN ROLE"` (4.56:1 contrast against white text, WCAG AA compliant).
  - Added `UNKNOWN_ROLE_ID` error issue in `core/validate.js` when `person.roleId` is missing, empty, not a string, or not found in `event.roles` (exact, case-sensitive matching). Message includes person ID and bad value.
  - Registered `UNKNOWN_ROLE_ID` in `IssueCode` enum in `core/schemas.js` (additive only).
  - Preserved `validate(scene)` without context so standalone scene validation still works and skips the role check.
  - Updated `composeDrafts` in `core/composer.js`: data errors like `UNKNOWN_ROLE_ID` do not hide designs. When a sampled person has `roleId: "boss"`, 3 drafts are still returned with the bad data visible on the card, and `result.issues` surfaces `UNKNOWN_ROLE_ID`.
  - Aligned fixtures in `core/fixtures.js`: added `"organizer"` and `"volunteer"` to `sampleEventSpec.roles` so valid stress tests pass.
  - Standardized `scripts/preview-sheet.js` to use canonical `EventSpec` structure `{ ...sampleEventSpec, roles: [...] }`.
  - Created `scripts/preview-unknown-role.js` demonstrating card with `roleId: "boss"` rendering `"UNKNOWN ROLE"` and blocking D-09 export gate.
  - 227 tests passed across 14 test files (`npx vitest run`).

- Task P0-1: Design-freeze fixes (bottom-stack spacing, 5.5 pt floor, scorer palette tones) (19 October 2026)
  - Files: `core/schemas.js`, `core/autofix.js`, `core/text.js`, `core/composer.js`, `core/themeDerivation.js`, `core/render.js`, `core/autofix.test.js`, `core/composer.test.js`, `scripts/measure-cards.js`, `scripts/preview-drafts.js`, `scripts/preview-card.js`, `scripts/preview-gallery.js`, `docs/PROGRESS.md`.
  - Font check: Verified that card rendering in `composer.js` sets `theme.fonts` directly to static pairings (`Space Grotesk` + `Inter` or `Source Serif 4` + `Source Sans 3`) and never reads `"Roboto"` from `content/brand-kits/*/brand.json`. Replaced remaining `"Roboto"` fallback strings in `core/themeDerivation.js` and preview scripts with static fonts (`Space Grotesk` and `Inter`). Preserved golden SVG outline tests in `core/content.test.js`, `core/d1.test.js`, and `core/logos.test.js`.
  - Bottom stack spacing: Enforced fixed >= 2.0 mm gaps between stacked blocks (`name`, `org`, `role-pill`, `id-line`, `qr-box`, and bottom `role-bar`). Clamped `photoH` to 34-35 mm in `hero-photo-top` (photo area remains > 40% of card height).
  - 5.5 pt text floor: Enforced Rule D-32 (overriding D-22 in code): autofix, text fitting (`core/text.js` ceiling step rounding), and composer block definitions never shrink text below 5.5 pt anywhere; name fitting retains 9 pt floor and role text >= 7 pt.
  - Palette scoring: Extended `scoreQuality` to count derived theme tones (`theme.colors.background`, `text`, `accent`), equalizing palette score to 25 across all modes (light, dark, colour-field) and events so palette score no longer biases draft selection.
  - Dynamic element drop: Registered `ELEMENT_DROPPED` in `IssueCode` in `core/schemas.js`. Under constrained vertical slot space, elements drop in strict order `QR` -> `org` -> `id-line`, emitting `ELEMENT_DROPPED` warning with `nodeId` as element name and person ID in message. When QR is disabled in spec, QR is omitted with no warning.
  - Condition 3 clash: Preserved and tested horizontal clash between `role-pill` and `qr-box` in `circle-badge-centre` template layout.
  - Measurement run (20 seeds, 3,840 cards across 4 archetypes x 3 modes x 8 stress people x 2 QR states):
    - Baseline: Min gap 0.436 mm, min text size 5.39 pt, breaking cards 3,840 / 3,840 (100.0%).
    - After P0-1: Min gap 2.0 mm, min text size 5.67 pt, breaking cards 0 / 3,840 (0.0%).
    - Drop counts: QR drops 480 / 960 (50.0%) per archetype due to validator `QR_TOO_SMALL` (< 15x15 mm) when QR is enabled; Org drops: `hero-photo-top` 42 (4.4%), `colour-block-split` 72 (7.5%), `circle-badge-centre` 78 (8.1%), `typographic-name-first` 120 (12.5%); ID-line drops: 0 (0.0%).
  - 239 tests passed across 14 test files (`npx vitest run`).

- Task B1: Bleed in the renderer (20 October 2026)
  - Files: `core/render.js`, `core/exportSettings.js`, `core/bleed.test.js`, `scripts/preview-drafts.js`, `docs/PROGRESS.md`.
  - Bleed input: Added optional `bleedMm` (0 to 10 mm, validated against `BleedMmSchema` imported directly from `core/exportSettings.js`). Negative, >10, NaN, Infinity, strings, and null are rejected with clear errors. Defaults to 0 when omitted, preserving 100% byte-identical SVG output against golden files.
  - SVG bleed geometry: When `bleedMm > 0`, card SVG viewBox expands to `-${bleedMm} -${bleedMm} ${54 + 2*bleedMm} ${85.6 + 2*bleedMm}` with width `${54 + 2*bleedMm}mm` and height `${85.6 + 2*bleedMm}mm` (60 x 91.6 mm for bleed 3). Scene coordinates do NOT move: trim box remains 0..54 by 0..85.6.
  - Decor extension in SVG only (Conditions 1 & 3): Scene nodes are never mutated: returned `scene` is strictly deep-equal with and without bleed, and validator issues are identical. Decor shapes identified strictly by `decor: true` touching or crossing trim edges (within 0.01 mm) extend outward by `bleedMm` in SVG emission. Non-decor shapes (text outlines, photos, logos, role pill) are never extended.
  - Trim safe-margin enforcement (Condition 5): Verified that existing `checkOutsideSafeMargin` in `core/validate.js` already catches non-decor elements touching the trim edge (distance 0 < 3 mm margin -> `OUTSIDE_SAFE_MARGIN`). No new issue code needed and `IssueCode` enum untouched.
  - Additive sheet boxes (Condition 6): Returned object additively exposes `trimBox: { x: 0, y: 0, w: 54, h: 85.6 }` (card-local, origin 0,0) and `bleedBox: { x: bleedMm === 0 ? 0 : -bleedMm, y: bleedMm === 0 ? 0 : -bleedMm, w: 54 + 2*bleedMm, h: 85.6 + 2*bleedMm }`, matching `SheetCell` box field names in `core/sheet.js`.
  - Visual preview overlay (Condition 7): Added `--bleed` CLI flag to `scripts/preview-drafts.js`. In `--bleed` mode, cards render with `bleedMm: 3` and superimpose an HTML/CSS dashed green trim line (`.trim-overlay`, 1.5px dashed #22C55E) directly positioned against the SVG's own box without round-corner clipping. Without `--bleed`, the output is 100% identical as before.
  - Tests: 10 new unit tests in `core/bleed.test.js` covering all 4 archetypes x 3 modes, scene node deep-equality, viewBox/size for bleed 0/1/3/10, golden SVG byte-identity, validator parity, invalid bleed inputs, determinism, 57-char names, decor: true flag only, and trim-touching non-decor safe margin.
- Task E2a: Single-card export (SVG and PNG, plus the D-09 gate) (20 October 2026)
  - Files: `server/export/gate.js`, `server/export/fileName.js`, `server/export/exportCard.js`, `server/export/index.js`, `server/export/export.test.js`, `scripts/export-demo.js`, `package.json`, `package-lock.json`, `docs/PROGRESS.md`.
  - D-09 Gate (`checkExportGate`): Pre-export validation gate that fails closed (refuses if issues is not an array). Any `error` issue (e.g. `UNKNOWN_ROLE_ID`) unconditionally refuses export. Any `warning` issue (e.g. `OUTSIDE_SAFE_MARGIN`, `ELEMENT_DROPPED`, `NO_PHOTO`) refuses export unless `acknowledgedWarnings: true`. Refused exports return `{ ok: false, issues, errors, warnings, reason }` and write zero bytes to disk.
  - Privacy-preserving Filenames (`fileNameFor` & `uniqueFileNames`): Generates filenames strictly from `person.id` (no fallback to names/emails, enforcing D-10). Sanitises slashes to hyphens (`a/b` -> `a-b`), strips path traversal (`..`), invalid Windows characters, control characters, and trailing dots/spaces. Guards Windows reserved device names with extension (`CON.svg` -> `card-CON.svg`). Caps base length at 64 chars. Deterministic batch helper `uniqueFileNames` adds `-2`, `-3` on collisions, treating names case-insensitively.
  - Single-Card Export (`exportCard`): Integrates with `core/render.js` and `core/exportSettings.js` schema (`format`, `card`, `bleedMm`, `dpi`, `orientation`). Returns `{ ok, fileName, mimeType, data, ... }`.
    - SVG format: Generates UTF-8 SVG string with XML declaration (`<?xml version="1.0" encoding="UTF-8"?>\n`), exact mm dimensions and viewBox (`-3 -3 60 91.6` at bleed 3), no `<text>` or `font-family` attributes (D-28), 100% byte-identical across runs. When brand has logo assets and fonts are provided, SVG embeds `<image>` elements with data URIs and `<path>` text outlines (~360 KB on real card).
    - PNG format: Rasterises SVG using `sharp` at target DPI with `limitInputPixels: false` (tested up to 1200 DPI). Pixel size matches $\text{Math.round}(\text{mm} / 25.4 \times \text{DPI})$. Verified corner pixel in bleed margin matches background/decor colour in all three modes (light, dark, colour-field), image has > 5 distinct colours (content rendered, differs from no-logos card), and output buffers are 100% byte-identical.
    - Asset preflight checks: `exportCard` strictly refuses export (`ok: false`, writes zero bytes) if `input.fonts` (heading and body opentype fonts) is missing or if any brand kit logo is missing loaded image data (`dataUri`, `width`, `height`), preventing blank text outlines or placeholder logo rects from exporting.
    - Unsupported formats & orientation: Format `"pdf"` returns a clear error stating it is deferred to Task E2b. Landscape orientation is refused with a clear message because card layouts are portrait-only and do not re-flow for a landscape canvas (deferred to Stage B). Invalid settings return Zod schema error unchanged.
  - Demo script (`scripts/export-demo.js`): Exports 1 card for 3 roles (`participant`, `mentor`, `organizer`) to `exports/` in both SVG and PNG at 300 DPI (bleed 3mm). Loads opentype fonts and brand kit `"test-logos"` (embedded JPEG data URIs). Demonstrates D-09 gate refusal with unknown role (`roleId: "boss"`), writing no file to disk.
  - Tests: 31 unit tests in `server/export/export.test.js` covering gate fail-closed, role errors, warnings ack, zero file writing, filename sanitisation/reserved names/traversal, asset preflight checks (missing fonts, unpopulated logo assets), SVG structure/dimensions/D-28, landscape refusal, non-empty card checks (image count, PNG differing without logos, >5 colours), and PNG rasterisation/density/corners/determinism at 72, 300, 600, 1200 DPI across all 3 modes (light mode sampled 3 px inside corner at (3, 3) matching role-bar fill #2563EB).
  - 280 tests passed across 16 test files (`npx vitest run`).

- Task T1: Fix text-fitting step rounding bug (20 October 2026)
  - Files: `core/text.js`, `core/text.test.js`, `scripts/measure-cards.js`, `scripts/export-demo.js`, `docs/PROGRESS.md`.
  - Diagnosis & Root Cause: In `core/text.js`, `startStep` was calculated with `Math.round(startMm * 10)` while `floorStep` and `minStep` were calculated with `Math.ceil(floorMm * 10 - 0.0001)`. For `startPt === minPt === 5.5 pt` (1.94028 mm), `startStep` yielded 19 while `floorStep` yielded 20. Because `startStep < floorStep`, Stage 1 and Stage 2 loops never executed, dumping clean IDs unconditionally into Stage 3 (truncation with `...` and `TEXT_TRUNCATED`).
  - Fix: Applied clamp `startStep = Math.max(Math.round(startMm * 10), floorStep)` (Condition 1). This guarantees `startStep >= floorStep` when `startPt >= floorPt`, preserves D-32 (never below 5.5 pt / 2.0 mm step), and prevents raising sizes above declared start sizes when `startPt > floorPt`.
  - Scan analysis (5.5 to 16.0 pt in 0.1 steps where start == min == floor):
    - 51 out of 106 tested pt values skipped Stage 1 under the old code (5.5, 5.7, 5.8, 6.0, 6.3, 6.6, 6.9, 7.1, 7.2, 7.4, 7.5, 7.7, 8.0, 8.3, 8.6, 8.8, 8.9, 9.1, 9.2, 9.4, 9.7, 10.0, 10.3, 10.5, 10.6, 10.8, 10.9, 11.1, 11.4, 11.7, 12.0, 12.2, 12.3, 12.5, 12.6, 12.8, 13.1, 13.4, 13.7, 13.9, 14.0, 14.2, 14.3, 14.5, 14.8, 15.1, 15.4, 15.6, 15.7, 15.9, 16.0).
    - 0 values skip Stage 1 after the fix.
    - Used in `composer.js` for `id-line` with `size: [5.5, 5.5]` across all 4 archetypes (`hero-photo-top`, `colour-block-split`, `circle-badge-centre`, `typographic-name-first`).
  - Golden files: Verified with `git diff --stat core/golden` (empty; `personNormal.svg` and `personLongName.svg` use `[9, 6.5]` and contain no `id-line`, so they remain 100% byte-identical).
  - Regression measurement run (20 seeds, 3,840 cards across 4 archetypes x 3 modes x 8 stress people x 2 QR states):
    - `id-line` `TEXT_TRUNCATED` warnings: dropped from 3,840 / 3,840 (100%) to 0 / 3,840 (0.0%).
    - Total `TEXT_TRUNCATED` warnings dropped from 4,896 to 1,056 (-3,840 exact difference).
    - Name truncations (840) and Org truncations (216) remained strictly identical.
    - Drop rates: QR 50.0%, Org drops (4.4%, 7.5%, 8.1%, 12.5%), ID-line drops (0.0%), and smallest gap (2.0 mm) remained strictly identical.
  - Demo script: Removed `acknowledgedWarnings: true` from `scripts/export-demo.js`. All 3 demo roles export with `issues: []` (zero warnings, zero errors).
  - Tests: Added 7 unit tests in `core/text.test.js` covering `HX26-P-001` across all archetypes/modes, 40/64-char IDs, real 5.5 pt truncation, 5.5 pt floor assertion, all 106 scan values, determinism, and Condition 3 node size verification.
  - 287 tests passed across 16 test files (`npx vitest run`).

- Task E2b: PDF, print sheets, ZIP, vector QR module (20 October 2026)
  - Files: `server/export/qr.js`, `server/export/pdf.js`, `server/export/exportCard.js`, `server/export/exportSheet.js`, `server/export/exportBatch.js`, `server/export/index.js`, `scripts/export-sheet-demo.js`, `scripts/measure-tree-memory.js`, `package.json`, `package-lock.json`, `server/export/export.test.js`, `server/export/exportE2b.test.js`, `docs/PROGRESS.md`.
  - Installed Approved Libraries (under `"dependencies"`):
    - `puppeteer`: `^25.14.0` (Chromium win64-155.0.8059.79 downloaded to `~/.cache/puppeteer/`, download size: 437.2 MB).
    - `archiver`: `^8.0.0` (ESM ZipArchive streamer).
    - `qrcode`: `^1.5.4` (pure QR matrix generator).
  - Requirements & Verifications Delivered:
    1. D-09 Batch Gate: Evaluated for every card across all modes before any Chromium launch. If ANY card has an unacknowledged warning or any error, the whole batch is refused, zero bytes are written, failing person IDs (IDs only, never names or emails) are listed, and Chromium is never started (verified with spy on `launchBrowser`). In addition, sheet-level layout warnings (such as `MARKS_NEAR_PAGE_EDGE` when `printerSafeMm` is large) pass through the gate and block the export unless `acknowledgedWarnings: true`.
    2. Single-Card Vector PDF: Exported via Chromium with exact page dimensions in mm (60 x 91.6 mm at bleed 3, 54 x 85.6 mm at bleed 0) and zero margins. Verified by reading raw PDF bytes (`inspectPdfBytes`) for `/MediaBox` ([0 0 170.078 259.653] at bleed 3) and asserting zero `/Type /Font` objects (100% vector outlines per D-28).
    3. Browser Lifecycle & Offline Security: Reused a single shared browser instance across batches. Guaranteed browser termination via `finally` block even when export throws (tested). Chromium network requests are strictly intercepted via `enforceOfflinePage` and blocked (`request.abort()`) unless `data:` URL or `about:blank`. Verified that untrusted HTTP image requests fail closed (`img.onerror` fires).
    4. Print Sheets PDF: Imposed using `sheetLayout` from `core/sheet.js` (9 portrait CR80 cards per A4 page at bleed 3). Emitted print-safe vector crop marks (0.35 mm stroke, 2 mm length, starting at bleed edge). Replaced card-nested SVG coordinates with unitless numbers (never writing `"mm"` on nested x, y, width, or height). Supports `groupByRole`. Refuses `sides: "back"` or `"both"` and landscape orientation with clear errors. Tested partly filled pages (1 card and 10 cards / 2 pages).
    5. Neutral Metadata: Both single card and sheet PDFs contain neutral metadata (`/Title (ID cards)`, `/Producer (Skia/PDF m155)`), with `Author` set to null (zero personal names, zero emails).
    6. Exact MediaBox & Structural Deduplication on A4 Sheet PDF:
       - MediaBox: `[0 0 594.95996 841.91998]` pt (expected 210 x 297 mm = 595.28 x 841.89 pt, difference: 0.32 pt width, 0.03 pt height, tolerance $\pm 0.5$ pt / $\pm 0.2$ mm).
       - Font objects: 0 (`/Type /Font`).
       - Image objects: 2 (`/Subtype /Image`) — exactly one image XObject per brand logo across all 9 cards, proving full Skia-level image deduplication.
       - Byte size: Single-card PDF: 270,924 bytes (~265 KB); 9-card Sheet PDF: 391,834 bytes (~383 KB). Ratio is 1.44x (far below 9x / ~2.4 MB).
    7. Clip-Path Isolation & 9-Card Region Comparison (Condition 1):
       - Per-card ID prefixing (`prefixCardSvgIds`) prevents `<clipPath>` and group ID collisions across multiple cards on a single page.
       - Verified with 9 DIFFERENT cards (different roles, names, circle and rounded photo shapes). Extracted each card subregion from the sheet PNG and compared pixel-for-pixel against the card rendered alone at 150 DPI (191,514 px per card).
       - Over 96% to 98% of pixels are identical (average 97.2% match across all 9 cards). Minor differences (2.0% - 3.9% of pixels) are strictly anti-aliasing edge rounding from subpixel offset placement on the sheet canvas. If clip-paths had collided, >30% of pixels in the photo region would have differed.
    8. Streamed ZIP Batch Packaging: Streamed via `archiver` (`ZipArchive`). Unique filenames generated strictly from `person.id` via `uniqueFileNames`. Contains privacy-safe `manifest.json` (`id`, `roleId`, `fileName` only; no names or emails). Tested with duplicate IDs.
    9. Vector QR Module (`server/export/qr.js`): `qrPath(url, options)` returns SVG path data and module count. Deterministic, HTTPS-only, clear error on invalid input. QR is not placed on cards (waits for Stage B per D-39).
    10. Performance Honesty & Process-Tree Measurement (Requirement 9):
       - Single-run benchmark for 235 cards (27 A4 sheet pages):
         - Execution time: 6.61 s
         - PDF file size: 930,567 bytes (908.8 KB)
         - Peak Node RSS: 361.20 MB
         - Peak Chromium RSS (all child processes): 313.37 MB
         - Peak Process-Tree Total RSS: 674.57 MB
       - Photo impact honesty: The synthetic cards did not embed raster photo images (rendered fallback SVG silhouette avatars because `person.photo` was a string path, not a base64 data URI). Real photos cannot be deduplicated across persons. If 235 cards contain distinct 100-250 KB JPEG/PNG data URIs, the PDF file size will increase from ~909 KB to approximately 24 - 35 MB, and peak process-tree memory will increase by ~175 - 325 MB to approximately 850 - 1000 MB (~0.85 - 1.0 GB).
    11. Comprehensive Test Coverage: 311 tests passing across 17 test files (including 24 in `server/export/exportE2b.test.js` and 31 in `server/export/export.test.js`).

- Task E2c: Real photos in export (resizing, memory safety, top-biased cover crop, clipping isolation, and bad-input security) (20 October 2026)
  - Files: `server/export/photoPrep.js`, `server/export/photoPrep.test.js`, `server/export/exportCard.js`, `server/export/exportSheet.js`, `server/export/exportBatch.js`, `server/export/index.js`, `scripts/measure-tree-memory.js`, `docs/PROGRESS.md`.
  - Requirements & Verifications Delivered:
    1. Photo Preparation Pipeline (`server/export/photoPrep.js`):
       - `preparePhotoForCard(input, options)`: Sharp-based photo processor that computes exact box dimensions (`boxMm / 25.4 * dpi`).
       - Never stretches: uses cover crop with top bias `0.20` toward top (matching A2 pipeline: `topOffset = slackH * 0.30`) when source aspect ratio differs from target photo box (tested 1600x2200 into square 1:1 and 4:5 boxes; target aspect ratios verified and top marker preserved).
       - Never upscales: `withoutEnlargement: true`. Accurately calculates and reports `effectiveDpi` (tested 1x1 px photo in 2-inch box = 0.5 DPI).
       - Flattens transparent PNGs onto `#FFFFFF` background.
       - Converts CMYK and Grayscale inputs cleanly to sRGB.
       - Strips all EXIF/metadata, encodes as JPEG quality 90.
       - Sequential processing: photos processed one at a time (no `Promise.all` across 235 images).
       - `sharp.cache` status: NOT set anywhere in `server/export` or `server/data`; left at Sharp default memory cache (50 MB, 20 items).
       - Immutability & Determinism: caller input `person` and `draft` objects are never mutated. Identical inputs yield byte-identical data URIs across runs.
    2. Dynamic Photo Box Discovery:
       - Discovered dynamically from rendered card scene node where `(n.type === "image" || n.type === "rect") && n.id === "photo"` and read from `node.box` (`{ x, y, w, h }` in mm). No hard-coded sizes.
       - Assumed photo box cached per draft archetype from a dry run to avoid redundant renders.
       - Re-inspection: if rendered card's real photo box differs from assumed box by > 0.01 mm, photo is re-prepared and card re-rendered. Tested with 57-character stress person across all 4 archetypes (`hero-photo-top`, `colour-block-split`, `circle-badge-centre`, `typographic-name-first`).
    3. Bad-Input Tests & Privacy Protection (Condition 8):
       - Rejects non-data-URI path strings (e.g. `"uploads/x.jpg"`), corrupt bytes, zero-length buffers, and photos exceeding `limitInputPixels` (50 MP).
       - Privacy: custom `PhotoPrepError` names person ID only (`[Person <id>]`), never participant names, emails, or file paths.
       - Strict batch gate: invalid photo on ANY card refuses the whole batch, writes ZERO bytes to disk, and NEVER starts Chromium.
    4. 9-Card Real-Photo Clip-Path Test on A4 Sheet (Requirement 3):
       - Verified 9 different cards with 9 distinct noisy real photos on one A4 sheet across circle and rounded frames.
       - Dominant color sampling proved the center of each card's photo area contains THAT card's unique photo color (and never Card 1's color).
       - Extracted sheet regions and compared pixel-by-pixel with standalone Chromium PNGs: average difference is 6.94% (min 3.05%, max 14.83%), differences strictly from subpixel anti-aliasing edge rounding and librsvg vs Chromium text/JPEG rasterization. Clip paths are 100% isolated.
    5. Benchmark Run (235 Cards with Real Photos):
       - Generated 235 deterministic noisy synthetic masters (~1600x2200 px, seeded LCG noise, unique color and marker):
         - Average Master JPEG Size: 2.08 MB (Total: 488.0 MB).
       - After Resize (E2c Pipeline):
         - Execution Time: 68.93 s
         - PDF File Size: 20.77 MB (21,777,477 bytes)
         - Peak Node RSS: 1748.07 MB (holding all 235 raw masters in benchmark process memory)
         - Peak Chromium RSS: 314.53 MB
         - Peak Total RSS: 2060.30 MB
       - Before Resize (Raw Masters in HTML):
         - Concatenating 235 raw masters (~650 MB of base64 data URIs) into a single HTML document threw V8 `Invalid string length`. Process stopped by safety check at 2034.53 MB before 1.5 GB crash.
       - Stop Rule Encountered: Total process-tree memory reached 2060.30 MB (> 1.5 GB), triggering stop rule to report real numbers and propose options.
    6. Comprehensive Test Suite: 324 tests passing across all 18 test files (including 13 tests in `server/export/photoPrep.test.js`, 24 in `server/export/exportE2b.test.js`, 31 in `server/export/export.test.js`). 0 lint errors.

## In progress

- None. Final ID Card Review & Export Workflow (Slice 4) complete.

## Next

- Stage B Card Back Generation, QR Code Integration, and Multi-surface badge workflows.

## Decisions and open questions

- D-17: layouts are pre-made; never drawn by AI.
- D-19: schemas and function signatures frozen in week 1.
- D-20: Text fitting algorithm order (17 October 2026):
  1. Stage 1: Single line with small shrink (from start size down to oneLineFloor in 0.1 mm steps; do not wrap).
  2. Stage 2: Split/wrap at spaces across maxLines (from start down to min size; word wider than box triggers shrink; force-broken by characters only at min size).
  3. Stage 3: Truncate last line with ellipsis ("...") at min size, returning status "truncated".
  4. Add optional `oneLineFloor` (pt) to text element schema (between start and min size).
- D-21: Validator context and decor flag (17 October 2026):
  1. `validate(scene, context = {})` accepts an optional second argument `{ card, brand, font, person, event, theme }` so that calling `validate(scene)` with 1 argument works without crashing.
  2. Added optional `decor: boolean` flag to block elements and scene nodes to separate content from decorative elements (`OVERLAP` ignores decor elements). Person B and Person C must be informed.
- D-22: Autofix text size limits (18 October 2026):
  1. Name text (`bind === "person.name"`) is never lowered below its own declared minimum (6.5 pt).
  2. For other text: if declared minimum is <= 5 pt, floor is declared minimum (autofix never raises a limit). Otherwise floor = max(5 pt, declaredMin - 1 pt).
- D-23: Optional element flag and additive fixes (18 October 2026):
  1. Added optional additive boolean flag `optional` to block elements and `SceneNode` in `schemas.js` (Person B and Person C must be informed).
  2. `renderCard` additively returns `{ svg, scene, issues, fixes }` without breaking existing `{ svg, scene, issues }` consumers.
- D-24: Pure-code theme derivation (18 October 2026):
  1. Each event has a palette of 1 to 3 colours; themes are DERIVED from it by pure code (`core/themeDerivation.js`).
  2. Role colours stay separate from the palette so roles remain distinguishable.
  3. Added optional additive `palette` array to `EventSpec.event`.
- D-25: Structural & visual distinctness (18 October 2026):
  1. The three drafts shown for ONE event must be clearly different from each other (structure, mode, colour strategy, type), not only in colour.
  2. No seeds, no random variation, no procedural patterns: looks are fixed, tested recipes with fixed parameters.
  3. Every pair of looks in an event group must have pairwise distance >= 5 under Spec 9.2 weights, with at least two disjoint groups of 3 looks.
  4. Added optional `mode`, `strategy`, and `typography` to `Look.attributes`.
- D-26 & D-27: Reserved for later decisions.
- D-28: Text as outlines (18 October 2026):
  1. All SVG output draws text as `<path>` outlines using the same opentype font that measured it (`font.getPath` / `textToPathData` with line's x, baseline y and size in mm, `toPathData` with 3 decimals).
  2. Honours anchor `start`, `middle`, and `end` using measured width.
  3. Node font role (`heading` or `body`) resolved from `input.fonts`.
  4. Each text node wrapped in `<g id="..." aria-label="...">` with XML-escaped label. No `<text>` elements and no `font-family` anywhere in the output.
  5. Scene text nodes keep `lines`, `sizeMm`, and `status` unchanged.
  6. Added validator check `TEXT_UNSUPPORTED_GLYPH` (severity Error) for any character mapping to glyph index 0 in its font (`font.charToGlyph`). Person B and Person C must be informed.
- D-29: Logo plate (18 October 2026):
  1. Added additive optional field `plate: { fill, radiusMm, paddingMm }` or `plate: "auto"` to `ImageBlockElement` and `ImageNode` in `schemas.js`.
  2. With `"auto"`, the renderer checks colour behind logo: if dark or saturated (relative luminance or HSL lightness < 0.9), a white rounded plate is drawn behind the logo with 1 mm padding and 1 mm corner radius (`decor: true`). If background is already near-white, no plate is drawn.
  3. Set `plate: "auto"` on all existing logo blocks. Person B and Person C must be informed.
- Provisional Decision: Dynamic Look Composition Spike (18 October 2026):
  1. Looks are composed per Generate from parameterised generators; seed stored with each draft; rendering deterministic. KB update pending until the spike gallery is approved.
  2. Added additive optional fields: `Look.seed` and `Look.attributes.archetype` in `schemas.js` (Person B and Person C informed).
- D-39: QR placement deferred to Stage B (19 October 2026):
  1. QR placement deferred to Stage B. Requirement: when qr.enabled, reserve a SQUARE of at least 15 x 15 mm plus clear space, planned into the layout. Until then the QR is dropped and ELEMENT_DROPPED is raised. The 2 mm gap, 5.5 pt and drop-rate numbers were measured without a QR on the card; re-measure when QR returns.
  2. Rule D-32 overrides D-22 in code: minimum text floor is strictly 5.5 pt across all elements and all autofix paths (D-32 wins over legacy D-22 allowance of 5 pt).
  3. Registered additive issue code `ELEMENT_DROPPED` in `core/schemas.js` (warning emitted when optional bottom-stack elements are dropped to maintain >= 2 mm spacing floor).
- D-40: Bleed in the renderer and SVG emission (20 October 2026):
  1. `renderCard` accepts optional additive `bleedMm` (0 to 10 mm, validated against `BleedMmSchema` imported directly from `core/exportSettings.js`).
  2. Bleed is applied exclusively when emitting SVG; returned `scene` remains in trim coordinates (0..54 by 0..85.6) and is strictly deep-equal with and without bleed.
  3. Decor shapes are identified exclusively by `node.decor === true` (never matching id "bg"). Decor rects touching or crossing trim boundaries extend outward by `bleedMm` on that edge in SVG. Non-decor elements are never extended into bleed.
  4. `renderCard` returns additive `trimBox`, `bleedBox`, and `bleedMm` matching `SheetCell` naming convention in `core/sheet.js`.
- D-41: Use sharp for single-card PNG rasterisation (approved by user, 20 October 2026):
  1. Use `sharp` (libvips + librsvg) for rasterising card SVG to PNG at target DPI (72..1200 DPI).
  2. Honest engineering rationale:
     - No browser launch overhead per PNG export.
     - Deterministic output on one platform (byte-identical across runs).
     - Physical DPI density metadata (`pHYs` chunk) written directly into the PNG header.
     - Text is already rendered as `<path>` outlines by `core/render.js` (D-28), eliminating OS/browser font discovery and font loading discrepancies.
   3. Known limitation: PNG is rendered via librsvg in Sharp, while PDF will be rendered via Chromium in Puppeteer (Task E2b). Because their SVG rasterisation engines differ, minor subpixel rendering differences may exist between PNG and PDF outputs; we will compare them once in E2b.
- D-42: Logo deduplication in multi-card print sheets (20 October 2026, Task E2b - Approved by user):
  1. Multi-card sheets replace the exact known data URI string of each brand kit logo with a `<use href="#id" ...>` pointing to a shared `<defs>` block (`<svg id="...">`).
  2. Replacements are strictly counted and asserted against `cards * logos`; any mismatch causes export refusal.
  3. Proved to prevent N-fold PDF size explosion: a 9-card sheet PDF is 392 KB (~1.44x of a 271 KB single-card PDF, not ~9x / 2.4 MB).
- D-43: Chromium vector PDF export via Puppeteer (20 October 2026, Task E2b - Approved by user):
  1. Puppeteer launches Chromium in offline sandbox (`request.abort()` for non-data requests).
  2. Embeds SVG inside minimal HTML wrapper styled with exact mm dimensions and `@page { size: ${wMm}mm ${hMm}mm; margin: 0; }`.
  3. Single shared browser instance is reused across exports and guaranteed closed in `finally` blocks.
  4. Tested raw bytes for exact `/MediaBox` and zero `/Type /Font` objects (all text is vector path outlines).
- D-44: Real photo preparation, aspect ratio cover-crop, and memory safety (20 October 2026, Task E2c / E2c-2):
  1. Real participant photos in export must be prepared via `preparePhotoForCard` before placing into SVG/HTML, shrinking them from ~2 MB masters down to the exact card slot dimensions (`boxMm / 25.4 * dpi`).
  2. Never stretches: cover-crops with top bias `0.20` toward the top (`topOffset = slackH * 0.30`, matching A2 pipeline) to prevent face distortion. Never upscales: `withoutEnlargement: true`.
  3. Flattens PNG transparency onto `#FFFFFF` and converts CMYK/Grayscale cleanly into sRGB JPEG (quality 90, no metadata).
  4. Sequential processing: photos are processed one at a time to prevent concurrency spikes.
  5. Dynamically reads photo box from scene node `(n.type === "image" || n.type === "rect") && n.id === "photo"` field `node.box` (caches per draft archetype; re-prepares if layout deviates by > 0.01 mm).
  6. Memory honesty & measured single-run footprint (Task E2c-2 / E2c-3): In a single 235-card run streaming noisy master files (~2.08 MB JPEG each) via `photoSource`, peak Node RSS was 578.52 MB, peak Chromium RSS was 316.22 MB, and total process-tree RSS was 892.91 MB (well below the 1.5 GB stop rule). Execution completed in 65.19 s with the full stage breakdown: Master disk reads (photoSource): 20.672 s, Photo preparation (Sharp): 33.919 s, Card render & outline gen: 2.000 s, D-09 batch gate checking: 0.001 s, Sheet imposition layout: 0.014 s, SVG assembly & logo dedupe: 0.337 s, Chromium PDF print: 8.212 s, Unattributed / overhead: 0.033 s. The stages sum to total wall-clock time within 33 ms (fully explaining the ~21 s time gap as streaming disk reads of 235 master JPEG files). PDF output size is 20.77 MB (27 A4 pages, 9 cards/page). The 235 prepared photo data URIs averaged 99.50 KB (22.83 MB total).
  *Note: T2 needed in core: photo nodes hardcode srcW/srcH 500, so the validator flags non-square photos; the export filter is a temporary workaround.*
- Published Core & Server Function Signatures (updated 20 October 2026):
  - `photoSource(personId)` -> `Promise<Buffer | null>`:
    Async function accepting `personId` (string) and returning `Promise<Buffer | null>`. `null` means "no photo" (initials avatar + `NO_PHOTO` warning under `acknowledgedWarnings: true`). Thrown errors, non-Buffer returns, or empty 0-byte buffers refuse the whole batch with `PhotoPrepError` naming the person ID only (`[Person <id>] ...`), before Chromium launches, writing nothing to disk. If both `person.photo` and `photoSource` exist, `photoSource` wins. Sequential only.
  - `renderCard(input)` -> `{ svg, scene, issues, fixes, trimBox, bleedBox, bleedMm }`
  - `autofix({ ...input, scene, issues })` -> `{ scene, issues, fixes }`
  - `validate(scene, context?)` -> `issues`
  - `applyOperation(design, op)` -> `design`
  - `pickThree(eligible, hints = [], excludedGroups = [])` -> `looks`
  - `compose(event, seed)` -> `{ skeleton, blocks, theme, look }`
  - `composeDrafts(event, options)` -> `[ { draft, seed, look, ... } ]`
  - `scoreQuality(look, scene, context)` -> `{ total, breakdown, pass }`
  - `parseExportSettings(input)` -> `ExportSettings`
  - `sheetLayout(settings, cards)` -> `{ pages, perPage, cols, rows, warnings }`
  - `preparePhotoForCard(input, options)` -> `Promise<{ dataUri, width, height, effectiveDpi }>`
  - `extractPhotoBoxFromScene(scene)` -> `{ x, y, w, h } | null`
  - `exportCard(input, settings, options)` -> `Promise<{ ok, fileName, mimeType, data, widthPx, heightPx, dpi, issues, errors, warnings, reason }>`
  - `exportSheet(input, settings, options)` -> `Promise<{ ok, fileName, mimeType, data, pages, cardsCount, issues, errors, warnings, reason }>`
  - `exportBatch(input, settings, options)` -> `Promise<{ ok, fileName, mimeType, data, count, manifest, issues, errors, warnings, reason }>`
  - `exportZip(files, options)` -> `Promise<Buffer>`
  - `checkExportGate(issues, options)` -> `{ ok, issues, errors, warnings, reason }`
  - `fileNameFor(person, format, index)` -> `string`
  - `uniqueFileNames(people, format)` -> `string[]`
  - `qrPath(url, options)` -> `{ path, d, modules, gridSize, margin }`
  - `renderSvgToPdf(svg, widthMm, heightMm, options)` -> `Promise<Buffer>`
  - `inspectPdfBytes(buffer)` -> `{ pageCount, mediaBoxes, fontCount, hasCreationDate }`
  - `emptySpec(designType)` -> `EventSpec`
  - `findGaps(spec)` -> `{ required, defaulted, optional, derived, hasRequiredGaps }`
  - `nextQuestions(spec, declined)` -> `{ questions, currentStep, totalSteps, allDone }`
  - `applyAnswer(spec, answer)` -> `{ ok, spec } | { ok: false, error }`
  - `lockSpec(spec)` -> `{ ok, spec } | { ok: false, error }`
  - `parseBrief(briefText, options)` -> `Promise<{ ok, spec, designType } | { ok: false, error, emptySpec }>`
- D-45: Server HTTP API, Storage Backends, and Personal Data Privacy (20 October 2026, Task S / Task S fix):
  1. Express REST API created (`server/app.js`, `server/routes/`, `server/storage/`) wrapping core layout engine, A2 data pipeline, and export engine. Zero unapproved packages (only `express` and `mongoose` added to package.json).
  2. Dual storage backend: in-memory (`createMemoryStorage`) and MongoDB via Mongoose (`createMongoStorage`), selected via `STORAGE=mongo|memory` (defaults to memory if MONGODB_URI is missing). Real `ping()` implemented on Mongo storage (`connection.db.admin().ping()`), surfaced via `GET /health` returning 503 `{ status: "error", storage: "mongo" }` if ping fails.
  3. Personal Data Privacy: Participant names, emails, and photos are personal data. Stored in MongoDB/memory strictly for export generation, but NEVER logged, NEVER returned in error messages, and NEVER included in client responses. All project documents (`POST /projects`, `GET /projects/:id`, `PUT /projects/:id`) and version documents (`POST /projects/:id/versions`, `GET /projects/:id/versions`) return `peopleCount` instead of `people` arrays.
  4. Data Ingestion Gating: `POST /projects/:id/data` returns status 200 with `{ report }` when valid participant rows exist. If some rows have validation errors (e.g. unknown role), those error rows are excluded from stored participants and reported in `report.rows`. Status 422 `DATA_VALIDATION_ERROR` is triggered only when zero valid participant rows remain (or on dataset parse failure), with the full A2 `report` included in the 422 JSON response body so the GUI can present error details. `eventCode` is passed directly to `buildDataset`.
  5. Photo Storage: Uploaded photo archives are streamed to disk under `os.tmpdir()/acm-studio/<projectId>/` and streamed on demand via `photoSource`. Deleting a project removes its photo directory.
  6. Export & Concurrency: Supports all formats (card SVG/PNG/PDF, sheet SVG/PDF, batch ZIP) gated by D-09 preflight checks. Concurrency guard allows only 1 active export per project at a time (409 `EXPORT_IN_PROGRESS`). 10-minute server request/header timeouts configured.
  7. Hand-rolled CORS: `server/cors.js` with zero external dependencies (no `cors` package), whitelisting localhost:5173, localhost:3000, and `ALLOWED_ORIGINS`.
  8. Flaky test resolution: Smoke test avoids concurrent Chromium Puppeteer launches with `exportE2b.test.js`, testing sheet/card/zip exports and concurrency locking via SVG and sharp, eliminating Skia alpha mask flakiness on `exportE2b.test.js:400`.


