# Frontend Developer Notes (Client Integration)

Written for Person C building `client/`. Plain words, short reference.

---

## 1. Published Core Function Signatures

All core functions are pure, deterministic, and synchronous (no network, database, or filesystem I/O in `core/`).

### `renderCard(input)`
Renders an SVG string and a scene graph from design JSON and data.
```javascript
import { renderCard } from "../core/index.js";

const { svg, scene, issues, fixes } = renderCard({
  skeleton,    // Skeleton JSON object
  blocks,      // Array of Block JSON objects
  theme,       // Theme JSON object
  look,        // Look JSON object
  person,      // Person data: { id, name, org, role, photo }
  event,       // Event data: { name, date, venue, orgName, orgShort, logoUrl, sponsorLogoUrl }
  fonts        // Object mapping { heading: opentypeFont, body: opentypeFont }
});
```

### `validate(scene, context?)`
Pure validator checking text overflow, margins, WCAG contrast, overlaps, and placeholders. The optional `context` enables deep checks.
```javascript
import { validate } from "../core/index.js";

const issues = validate(scene, { card: skeleton.card, theme, event, person });
// Returns Array of Issue objects: [{ code, message, severity: "error" | "warning", node }]
```

### `composeDrafts(event, options?)`
Composes 3 distinct candidate drafts (diverse archetypes and modes) from an event specification and a deterministic seed.
```javascript
import { composeDrafts } from "../core/index.js";

const { drafts, seed } = composeDrafts(event, {
  seed: 42,                  // Number or string. Core NEVER calls Math.random()
  count: 3,                  // Number of distinct drafts requested (default: 3)
  previousArchetypes: [],    // Optional: archetypes from earlier clicks to avoid repeating
  previousSeeds: []          // Optional: earlier seeds
});
// Each draft in drafts: { skeleton, blocks, theme, look, score }
```

### `applyOperation(design, op)`
Applies a single targeted editing operation to an existing design bundle without regenerating.
```javascript
import { applyOperation } from "../core/index.js";

const updatedDesign = applyOperation(currentDesign, {
  op: "setFontPair",
  target: "look.attributes.typography",
  value: "editorial-serif"
});
```

### `sheetLayout` and Export Functions
- **Status**: Not in `core/` yet. Scheduled for **Stage A1** (Export module).
- `sheetLayout` will calculate 8-up A4 imposition with cut marks. For now, preview and render single cards via `renderCard`.

---

## 2. Generate / Regenerate Model

1. **Seed-Driven**: `composeDrafts` accepts an explicit `seed` parameter. `core/` **never** calls `Math.random()` or `Date.now()`.
2. **New Seed Per Click**: Every time the user clicks "Generate" or "Regenerate", the frontend (or server) supplies a new seed (e.g. `Date.now()`, random integer, or UUID string).
3. **Draft Package**: Every generated draft carries its `seed` and complete self-contained `{ skeleton, blocks, theme, look }` JSON bundle.
4. **Zero-Compose Re-rendering**: Re-rendering a saved draft never calls `composeDrafts`. Simply pass the saved `{ skeleton, blocks, theme, look }` directly to `renderCard(input)`. Output is guaranteed byte-identical across runs (D-11).

---

## 3. Additive Optional Fields

Every field below is optional and backwards-compatible:

- `decor` (boolean on Block elements and Scene nodes): Marks decorative elements (bars, backgrounds); the `OVERLAP` validator ignores them.
- `optional` (boolean on Block elements and Scene nodes): Marks non-critical elements; autofix may hide them cleanly without leaving empty layout gaps.
- `plate` (`"shared"` | `"auto"` | `{ fill, radiusMm, paddingMm }` on image blocks): Emits a white rounded backing plate for logos on dark or saturated backgrounds; `"shared"` renders a single plate spanning both logos.
- `seed` (string | number on Look): Records the generation seed for full auditability and reproduction.
- `archetype` (string on `Look.attributes`): Identifies the layout archetype (`hero-photo-top`, `colour-block-split`, `circle-badge-centre`, `typographic-name-first`).
- `clip` (`"circle"` | `"rounded"` | `"square"` on image blocks): Clips photos cleanly without image corners poking out.
- `modeFallback` (boolean on `Look.attributes`): Indicates whether a requested dark or colour-field mode fell back because the palette could not support sufficient contrast.
- `stroke` (hex string on rect elements and scene nodes): Outline stroke color for borders and pills.
- `strokeWidth` (number in mm on rect elements and scene nodes): Outline stroke thickness (e.g. 0.6 mm high-contrast outline on role pills).
- `palette` (array of 1 to 3 hex strings on `EventSpec.event`): Event brand colors used for pure-code theme derivation (D-24).
- `typography` (string on `Look.attributes`): Active font pairing ID (`modern-grotesk`, `editorial-serif`).
- `oneLineFloor` (number in pt on text elements): Size floor down to which text shrinks on one line before multi-line wrapping kicks in.

---

## 4. Vector Text Outlines & Glyph Checking

- **Path Outlines**: All text in `renderCard` is converted to vector `<path>` outlines using `opentype.js` (D-28). Output SVGs contain **zero** `<text>` or `font-family` tags. Cards render identically on all machines and mobile screens without client font installation.
- **Accessibility & Inspector**: Each text shape is wrapped in `<g id="..." aria-label="...">` preserving the original text for accessibility and DOM inspection.
- **Unsupported Glyphs**: If a character is missing from the active font (maps to glyph index 0), the validator emits `TEXT_UNSUPPORTED_GLYPH` with severity `error`. Preflight must catch this before export.

---

## 5. How to Run Tests and Previews

- **Run Core Test Suite**:
  ```bash
  npx vitest run
  ```
- **Generate Draft Gallery (Visual Preview)**:
  ```bash
  node scripts/preview-drafts.js
  ```
  Generates `drafts.html` in the root folder, displaying side-by-side composed drafts for 10 events, 5 seeds for one event, role matrices, and grayscale toggles.
- **Content Reference**:
  Read [docs/ADDING_CONTENT.md](file:///c:/Users/Prakashkumar/Content-Marketing-Studio/docs/ADDING_CONTENT.md) for instructions on defining skeletons, blocks, themes, and looks.

---

## 6. Code Ownership & Boundaries

- **Person C**: Owns `client/` (React frontend, UI components, editor, user state, preview UI).
- **User**: Owns `server/` (Express API, database, file uploads, export jobs) and `core/` (schemas, render, text, composer, validator).
- **Antigravity (AI Assistant)**: `client/` is **strictly off-limits**. Antigravity will never create, edit, or delete files inside `client/`.
