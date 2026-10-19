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

## In progress

- Physical print test: print `card.svg` on a real printer to verify physical dimensions, margin, and logo sizes (from Task 3).

## Direction change

- This is a long-term product for the club, not a hackathon demo.
- Task D1 (rendering foundations: text as outlines D-28, logo plate D-29, silhouette and initials placeholders) is done. The design rework tasks D2 to D5 are DEFERRED. The six current looks are provisional "Templates v0" (Formal and Tech are the keepers; Bold, Minimal, Editorial and Playful are usable but provisional). We build with them.
- Later plan: AI-generated designs; if not good, add more hand-made design parts. If the AI is used, it should write looks in our JSON format, not raw SVG, and every AI design must pass schema, stress test and a gallery review before it is saved as a template. D-17 stays until then.
- D-25: the three drafts for ONE event must be clearly different. D-12 stays, with the long-term reason: the core path (CSV, drafts, export) must work without AI; the AI gateway must be swappable.
- Known design issues (deferred): role colour is the same blue on every palette and clashes; name type is small (9 pt start); four looks share one layout; logos with white backgrounds look like stickers on colour; dark looks use a fixed navy; "valid" in the gallery means "no errors", not "good-looking" (rename the badge to "no errors" if not done); QR placement deferred to Stage B (D-39): when qr.enabled, reserve a SQUARE of at least 15 x 15 mm plus clear space, planned into the layout. Until then the QR is dropped and ELEMENT_DROPPED is raised. The 2 mm gap, 5.5 pt and drop-rate numbers were measured without a QR on the card; re-measure when QR returns.
- Planned later: two-sided cards (card sides: front or both).

## Next

- Task E2b: Multi-card and print-sheet export (PDF via Puppeteer, print sheets, ZIP bundle).

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
- Published Core & Server Function Signatures (updated 20 October 2026):
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
  - `exportCard(input, settings, options)` -> `Promise<{ ok, fileName, mimeType, data, widthPx, heightPx, dpi, issues, errors, warnings, reason }>`
  - `checkExportGate(issues, options)` -> `{ ok, issues, errors, warnings, reason }`
  - `fileNameFor(person, format, index)` -> `string`
  - `uniqueFileNames(people, format)` -> `string[]`
