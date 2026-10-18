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

## In progress
- Physical print test: print `card.svg` on a real printer to verify physical dimensions, margin, and logo sizes (from Task 3).

## Direction change
- This is a long-term product for the club, not a hackathon demo.
- Task D1 (rendering foundations: text as outlines D-28, logo plate D-29, silhouette and initials placeholders) is done. The design rework tasks D2 to D5 are DEFERRED. The six current looks are provisional "Templates v0" (Formal and Tech are the keepers; Bold, Minimal, Editorial and Playful are usable but provisional). We build with them.
- Later plan: AI-generated designs; if not good, add more hand-made design parts. If the AI is used, it should write looks in our JSON format, not raw SVG, and every AI design must pass schema, stress test and a gallery review before it is saved as a template. D-17 stays until then.
- D-25: the three drafts for ONE event must be clearly different. D-12 stays, with the long-term reason: the core path (CSV, drafts, export) must work without AI; the AI gateway must be swappable.
- Known design issues (deferred): role colour is the same blue on every palette and clashes; name type is small (9 pt start); four looks share one layout; logos with white backgrounds look like stickers on colour; dark looks use a fixed navy; "valid" in the gallery means "no errors", not "good-looking" (rename the badge to "no errors" if not done).
- Planned later: two-sided cards (card sides: front or both).

## Next
- Review spike gallery `drafts.html` with user; upon approval, update knowledge base and refine archetypes/scoring.

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
- Published Core Function Signatures (updated 18 October 2026):
  - `renderCard(input)` -> `{ svg, scene, issues, fixes }`
  - `autofix({ ...input, scene, issues })` -> `{ scene, issues, fixes }`
  - `validate(scene, context?)` -> `issues`
  - `applyOperation(design, op)` -> `design`
  - `pickThree(eligible, hints = [], excludedGroups = [])` -> `looks`
  - `compose(event, seed)` -> `{ skeleton, blocks, theme, look }`
  - `composeDrafts(event, options)` -> `[ { draft, seed, look, ... } ]`
  - `scoreQuality(look, scene, context)` -> `{ total, breakdown, pass }`
