# Progress log

## How to update this file
- After every task, update this file yourself. Do not wait for me to ask.
- Move finished items to Done, with the date and the files involved.
- Keep In progress accurate: what is half-finished, what is known to be broken or unverified.
- Keep Next to the single next task, with one line on why.
- Record any decision made or question left open under Decisions and open questions, with the date.
- Be honest: only mark something Done if its tests pass. Say how you checked.

## Done
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

## In progress
- Physical print test: print `card.svg` on a real printer to verify physical dimensions, margin, and logo sizes (from Task 3).

## Direction change (design rework)
- **Product Vision**: This is a long-term product for the club, not a hackathon demo. All roadmap milestones target the first real event release.
- **D-24 (refined)**: Each event has a palette of 1 to 3 colours; themes are derived from it as colour ROLES (dominant, secondary, accent, neutral plus tints and shades). Large areas use dominant and neutral. Role colours stay separate and move to small pills or tags so they do not clash with the palette.
- **D-25**: The three drafts for ONE event must be clearly different (layout, shape between zones, mode, type, finish), not only in colour. There is no event-to-event variety requirement, and no seeds or random variation.
- **D-12 (stays, with updated rationale)**: The core path (CSV, drafts, export) must work without AI so the product survives API, pricing or model changes. The AI gateway must be swappable (model name in config, one interface).
- **Design Plan (Three Layers)**:
  1. *Templates*: Hand-designed looks. Formal and Tech are kept as templates.
  2. *Composer*: Looks assembled from layouts, shapes between zones, photo shapes, role treatments, patterns, font pairs and finishes, validated and stress-tested.
  3. *AI Art Director (optional, later)*: Chooses from the composer's menu, never places elements.
- **Two-Sided Cards Planned**: Card sides: front or both; back layouts reuse the same theme, pattern and fonts; duplex pages are mirrored.
- **Status of Existing Looks**: Formal and Tech are templates. Bold, Minimal, Editorial and Playful are provisional: re-evaluate in the gallery after the colour and type fixes, then keep, rework or archive each.
- **Known Problems Found in Gallery Review**:
  1. Palette barely affects the cards (role colour dominates headers and bars).
  2. Four looks share the same layout.
  3. Name type is too small.
  4. Logos with white backgrounds look like stickers.
  5. Text is shown in a fallback font in the browser (so what we see differs from what was measured).
- **New Task Sequence (avoiding clashes with finished 7B and 7C)**:
  - **D1**: Rendering foundations (text as outlines D-28, logo plate D-29, silhouette and initials placeholders, rounded corners in the gallery).
  - **D2**: Colour and type system.
  - **D3**: Composer (shapes, patterns, layouts, each reviewed in the gallery).
  - **D4**: Back side.
  - **D5**: Picker and mood tags (Task 8 picker becomes D5).

## Next
- D1: Rendering foundations (text as outlines D-28, logo plate D-29, silhouette and initials placeholders, rounded corners in the gallery).
- Future sequence for first real event release: D2 (colour and type system) -> D3 (composer) -> D4 (back side) -> D5 (picker and mood tags).
- Note: Compact density repair in autofix is currently a stub until renderer supports density.
- Note: Until a look marks something optional, repair (b) in autofix does nothing.
- Note: `PHOTO_LOW_RES` deferred to preflight.
- Note: `LOGO_MISSING` currently counts placeholder nodes as present; this will change when real logos arrive.
- (Note: Outlining text to vector paths with `opentype.js` is part of Task D1).

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
- D-26: Additive optional fields on LogoSpec (18 October 2026):
  1. Added optional additive fields `dataUri`, `width`, `height` to `LogoSpec` schema in `schemas.js` to carry in-memory asset payload without breaking week 1 frozen signatures (D-19).
- Published Core Function Signatures (18 October 2026):
  - `renderCard(input)` -> `{ svg, scene, issues, fixes }`
  - `autofix({ ...input, scene, issues })` -> `{ scene, issues, fixes }`
  - `validate(scene, context?)` -> `issues`
  - `applyOperation(design, op)` -> `design`
  - `pickThree(eligible, hints = [], excludedGroups = [])` -> `looks`
