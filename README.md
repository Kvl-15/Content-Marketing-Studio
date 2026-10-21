# ACM Content Marketing Studio

ACM Content Marketing Studio is an event identity and print-ready ID card generator built for the ACM NIT Surat student chapter. It turns natural-language event briefs and attendee spreadsheets into structured event specs, candidate designs, real-time card previews, and print-ready vector PDF/PNG/SVG files.

---

## Table of Contents

- [Core Principles](#core-principles)
- [System Architecture & Team Ownership](#system-architecture--team-ownership)
- [Worked Example: Brief to Print-Ready PDF](#worked-example-brief-to-print-ready-pdf)
- [Photo Processing & Frame Clipping](#photo-processing--frame-clipping)
- [Tech Stack & Dependencies](#tech-stack--dependencies)
- [Local Development](#local-development)
- [Deployment Guide](#deployment-guide)
- [Troubleshooting](#troubleshooting)
- [Project Status & Known Issues](#project-status--known-issues)

---

## Core Principles

The project follows a set of strict rules defined in the project specification:

1. **AI never draws geometry (D-01, D-17, D-31):** The AI model only extracts event details from unstructured text briefs into a structured JSON event spec. Card layouts, coordinates, colors, and shapes are assembled by deterministic JavaScript code in `core/composer.js`.
2. **One shared renderer (D-04):** Both the browser preview and the server PDF exporter call `renderCard()` in `core/renderCard.js`.
3. **Participant privacy (D-10, D-45):** Participant names, emails, and photos are never sent to external AI APIs. The server request logger records only the HTTP method, route, status code, and duration, omitting request bodies and personal data.
4. **Physical millimeters (D-05):** All layout coordinates use physical millimeters (`mm`). Standard CR80 badge trim is 54 × 85.6 mm, with a default 3 mm bleed margin (60 × 91.6 mm).
5. **Text as vector path outlines (D-28):** All text is converted into SVG `<path>` outlines using static font files bundled in the repository. Because text is rendered as path outlines rather than embedded font files, missing-font substitution issues at print shops are prevented.
6. **Preflight gate (D-09):** Layout errors (such as unmapped roles or missing required logos) block export with HTTP 422. Warnings (such as an attendee missing a photo) require explicit operator acknowledgement before export.
7. **Manual fallbacks (D-12):** Every AI-assisted step has a manual form fallback so organizers can complete card generation if the AI service is offline or unconfigured.
8. **Deterministic rendering (D-06, D-11):** The `core/` package contains no I/O, network requests, or system clock calls. Drafts re-render identically from a saved integer seed.
9. **Dual storage backends (D-14):** In-memory storage is used for quick local development; MongoDB Atlas is used for persistent project and version snapshots.

For the complete historical decision register (D-01 through D-45), see [`docs/knowledge-base.md`](docs/knowledge-base.md).
For documented differences between older design specs and the current codebase, see [`docs/README_CONFLICTS.md`](docs/README_CONFLICTS.md).

---

## System Architecture & Team Ownership

The repository is structured as an npm workspaces monorepo:

```text
Content-Marketing-Studio/
├── client/          # React 19 + Vite 6 frontend SPA
├── core/            # Pure layout engine: schemas, composer, renderer, validator, sheet imposition
├── server/          # Express 5 REST API, Gemini intake, photo ingestion, Puppeteer PDF exporter
├── content/         # Declarative JSON templates (skeletons, blocks, themes, compatibility rules)
├── assets/          # Static fonts (Inter, Space Grotesk, Source Sans 3) and brand logos
├── scripts/         # Production server runner, test probes, visual preview utilities
├── docs/            # Engineering specifications, decision registers, API contracts
├── Dockerfile       # Multi-stage production container definition (Node 22 + Chromium)
└── vercel.json      # Production static deployment rewrites for Vercel
```

### Folder Responsibilities

Per the project rules in [`docs/AGENT_RULES.md`](docs/AGENT_RULES.md), code ownership is organized by directory:

- **`core/`**: Pure functions for schemas, layout composition, text fitting, validation, autofix, and print-sheet imposition. Contains no network, database, or filesystem code.
- **`server/`**: Express routes, Gemini AI intake gateway, tabular data parsing, photo archive extraction, storage interfaces, and Puppeteer PDF export.
- **`client/`**: React user interface, step coordinator, API client, and preflight issue classification.
- **`content/` & `assets/`**: Declarative JSON design blocks, skeletons, brand logos, and open-source font files.

---

## Worked Example: Brief to Print-Ready PDF

Here is how an organizer runs a complete event batch from raw input to finished PDF sheets:

1. **Intake (`POST /intake/parse`):**
   The organizer submits an event brief:
   ```text
   "ID cards for Hackathon SVNIT Surat on 2026-10-25 with 150 participants and 20 mentors."
   ```
   The server calls Gemini to extract an `EventSpec` with event details, roles (`participant`, `mentor`), and default badge dimensions. The organizer reviews the checklist in the UI and locks the spec via `POST /intake/lock`.
2. **Attendee Data (`POST /projects/:id/data`):**
   The organizer uploads a CSV spreadsheet (`Name,Role,Email`). The parser validates headers, checks role mappings, generates deterministic IDs (`HX26-P-001`), and returns a dataset report.
3. **Photos (`POST /projects/:id/photos`):**
   The organizer uploads a ZIP archive of attendee images. The server validates image headers, converts them to sRGB JPEGs, crops them, and links them to attendee records.
4. **Design Drafts & Selection (`POST /projects/:id/drafts`):**
   The composer generates 3 structurally distinct card layouts across different design archetypes and color modes. The organizer selects draft 0 and saves Version 1 via `POST /projects/:id/versions`.
5. **Print Sheet Export (`POST /projects/:id/export`):**
   The organizer requests an A4 print sheet:
   ```json
   { "kind": "sheet", "format": "pdf", "paper": "A4" }
   ```
   The server runs preflight checks, lays out 9 cards per A4 page with 0.35 mm crop marks, deduplicates repetitive logo vectors, renders the pages in headless Chromium, and returns `print-sheets.pdf`.

---

## Photo Processing & Frame Clipping

### How Photos Are Processed

1. **Ingestion (`server/data/photos.js`):**
   Uploaded photos are extracted with `yauzl`. Sharp converts images to sRGB, strips metadata, and applies a cover crop with a `0.20` top bias (moving the crop window 20% toward the top of the image to keep the subject in frame).
2. **Card Frame Placement (`core/render.js`):**
   In SVG output, the photo is rendered into an `<image>` element clipped by a `<clipPath>` (`<circle>` or `<rect rx="3">`) defined by the card's chosen block template.

### Head-Cropping Behavior

The `0.20` top bias works well for standard landscape-to-portrait crops. However, because card templates clip photos using a centered circular or rounded rectangle frame without face detection, headshots where the person's head sits near the top of the original image can have the top of the head cut off by the frame curve. This is documented under [Known Issues](#project-status--known-issues).

---

## Tech Stack & Dependencies

All dependencies are pinned and verified in `package.json`:

- **Runtime:** Node.js 22.x (`>=22.0.0 <23.0.0`)
- **Backend:** Express `^5.3.0`, Mongoose `^9.11.2`, Zod `^4.6.7`
- **Image & Data Processing:** Sharp `^0.35.5`, Yauzl `^3.4.0`, Archiver `^8.0.0`, PapaParse `^5.7.0`, SheetJS `xlsx@0.20.3` (via vendor CDN tarball), QRCode `^1.5.4`
- **PDF Generation:** Puppeteer `^25.14.0` (headless Chromium)
- **Frontend:** React `^19.3.1`, React-DOM `^19.3.1`, Vite `^6.0.0`
- **Testing & Code Quality:** Vitest `^5.0.4`, ESLint `^10.12.0`, Prettier `^3.9.10`

---

## Local Development

### Prerequisites

- Node.js 22.x (`>=22.0.0 <23.0.0`)
- npm 10.x or higher

### Installation

```bash
git clone https://github.com/Kvl-15/Content-Marketing-Studio.git
cd Content-Marketing-Studio
npm ci
```

### Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Key environment variables:

```env
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
STORAGE=memory
MONGODB_URI=mongodb://localhost:27017/acm-studio
PHOTOS_DIR=
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3-flash-preview
GEMINI_THINKING_LEVEL=low
```

For client development targeting a separate server, configure `client/.env`:

```env
VITE_API_URL=http://localhost:3000
```

### Running Locally

```bash
# Build the client and run the server on http://localhost:3000
npm run build
npm start

# Or run client with hot reloading on http://localhost:5173 (in a separate terminal)
npm run dev --workspace=@acm-studio/client
```

### Automated Tests

The repository includes 502 automated tests across 29 test files:

```bash
npm run test:all      # Run all 502 tests across the monorepo
npm run test:core     # Run 15 core test suites (257 tests)
npm run test:server   # Run 12 server test suites (201 tests)
npm run test:client   # Run 2 client test suites (44 tests)
npm run lint          # Run ESLint across packages
npm run format:check  # Check formatting with Prettier
```

---

## Deployment Guide

### Architecture: Vercel (Frontend) + Render Free (Backend)

The application is configured to run on free hosting tiers:

- **Frontend:** Deployed to Vercel as a static Single Page Application.
- **Backend:** Deployed to Render as a Docker Web Service running Express, Chromium, and PDF generation.
- **Database:** MongoDB Atlas M0 free cluster.

### Branch Strategy

- Currently, deployment configuration is prepared and tested on branch **`render-deploy`**.
- When ready for production, `render-deploy` will be merged into **`main`**. Vercel and Render should then track `main` for automated deployments.

### Vercel Configuration (Frontend)

1. Import the repository into Vercel.
2. Set **Root Directory** to `client` (or keep `./` with build command `npm run build --workspace=@acm-studio/client`).
3. Set **Framework Preset** to `Vite`.
4. Set Environment Variable:
   ```env
   VITE_API_URL=https://<your-render-service>.onrender.com
   ```
5. **Rewrite Files:** Both `vercel.json` (at repo root) and `client/vercel.json` contain the SPA rewrite (`/(.*)` -> `/index.html`). If Vercel root is set to `client`, `client/vercel.json` is used; if root is `./`, the top-level `vercel.json` is used. They do not conflict.

### Render Configuration (Backend Docker)

1. Create a **New Web Service** from the Git repository.
2. Select **Docker** environment and branch `render-deploy` (or `main`).
3. Set Instance Type to **Free (512 MB)**.
4. Set Environment Variables:
   ```env
   NODE_ENV=production
   PORT=3000
   STORAGE=mongo
   MONGODB_URI=<your-mongodb-atlas-uri>
   ALLOWED_ORIGINS=https://<your-vercel-app>.vercel.app
   PHOTOS_DIR=/data/photos
   GEMINI_API_KEY=<optional>
   ```

### Free-Tier Operational Constraints

- **512 MB Memory Limit:** In memory benchmarks, a 215-attendee sheet export peaked at approximately 804 MB combined Node.js and Chromium memory. On a 512 MB free tier instance, running 200+ cards in a single PDF will cause an out-of-memory crash. Keep exports on Render Free to batches of **25 to 30 cards (up to 3 A4 pages)** or export by role groups.
- **Single Concurrency:** Concurrency is restricted to 1 active export per project via `activeProjectExports` in `server/routes/export.js`.
- **Ephemeral Photos:** Render Free instances spin down after 15 minutes of inactivity and do not support persistent disks. Files written to `/data/photos` are wiped when the container restarts.

---

## Troubleshooting

Based on verified behavior:

### 1. Missing `.env` File

- **Behavior:** `scripts/serve.js` catches the missing file and proceeds. Storage defaults to in-memory (`STORAGE=memory`). The server logs `[storage] Using in-memory storage backend.` and listens on port 3000.
- **Fix:** If persistent storage is needed, create `.env` from `.env.example` and supply a valid `MONGODB_URI`.

### 2. Invalid or Expired Gemini API Key

- **Behavior:** `POST /intake/parse` attempts the request, catches HTTP 400 from Google API, and returns HTTP 422 with code `BRIEF_PARSE_FAILED`. The response body includes an `emptySpec` scaffold.
- **Fix:** The UI automatically falls back to the manual form so you can fill in event details by hand. To use AI extraction, update `GEMINI_API_KEY` in `.env` with a valid key from Google AI Studio.

### 3. Unreachable or Invalid MongoDB URI

- **Behavior:** Server startup attempts connection with a timeout. If the host is unreachable, it logs `[storage] Failed to connect to MongoDB; falling back to in-memory storage:` and starts successfully in memory mode.
- **Fix:** Check your `MONGODB_URI` connection string, ensure database user credentials are correct, and verify network access permissions in MongoDB Atlas.

### 4. Corrupt or Non-Image Files in Photo ZIP

- **Behavior:** `POST /projects/:id/photos` streams the archive. Valid images are converted; corrupt images or non-image files (such as `.txt` files) are skipped and reported in the `warnings` and `ignoredFiles` arrays in the JSON response.
- **Fix:** Check the upload report in the UI for unmatched rows and upload an updated ZIP containing valid JPEG, PNG, or WebP files.

### 5. CSV With Unknown Roles or Invalid Headers

- **Behavior:** When uploaded without confirmed column mappings, the server returns the detected mapping proposal. When mapped rows contain roles not present in `eventSpec.roles`, those rows are marked with error `UNKNOWN_ROLE_ID`. If zero valid rows remain, the endpoint returns HTTP 422 `DATA_VALIDATION_ERROR` with the full error report.
- **Fix:** Edit the CSV to use role names matching the event specification, or add the missing roles to the event specification before importing attendee data.

---

## Project Status & Known Issues

### What Works

- Natural-language brief extraction with manual form fallback.
- Tabular attendee CSV/XLSX parsing with automatic column matching and NFC text normalization.
- Photo ZIP ingestion with sRGB normalization and magic byte validation.
- Parametric draft composition generating 3 distinct looks with WCAG-compliant color derivation.
- Single-renderer SVG card preview matching print output.
- Preflight validation separating synthetic test persona issues from real attendee warnings.
- Single card PDF/PNG export and A4/A3 imposition print sheets with logo deduplication.

### Known Issues & Planned Work

1. **Photo Head Cropping:** The current top-bias crop and SVG frame clipping do not use face detection. Headshots where the subject's face is positioned near the top of the frame can have hair or foreheads clipped by circular card frames.
2. **Two-Sided Cards (Front & Back):** The current print sheet imposition supports front-side badge printing only. Two-sided printing (`sides: "both"`) is deferred to a future development phase.
3. **QR Codes on Badge Faces:** While vector QR code generation is implemented as a standalone utility (`server/export/qr.js`), placing QR codes directly on card faces is deferred (D-39).
4. **Ephemeral Photos on Render Free:** Render Free containers wipe disk storage on spin-down. Moving photo storage to cloud storage or MongoDB GridFS is planned for permanent persistence on free hosting.

---

## Attribution

Developed for **ACM NIT Surat** (Association for Computing Machinery, Student Chapter, SVNIT Surat). Private repository for internal club operations.
Fonts in `assets/fonts/` (Inter, Space Grotesk, Source Sans 3) are licensed under the SIL Open Font License (OFL).
