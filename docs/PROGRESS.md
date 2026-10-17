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

## In progress
- Physical print test: print `card.svg` on a real printer to verify physical dimensions, margin, and logo sizes (from Task 3).

## Next
- Task 6: Autofix (Part 11 of knowledge base; note: autofix must never shrink name text below its minimum, 6.5 pt).
- Note: `PHOTO_LOW_RES` deferred to preflight.
- Note: `LOGO_MISSING` currently counts placeholder nodes as present; this will change when real logos arrive.
- (Note: Outlining text to vector paths with `opentype.js` is deferred to a later task).

## Decisions and open questions
- D-17: layouts are pre-made
- D-19: schemas and function signatures frozen in week 1
- D-20: Text fitting algorithm order (17 October 2026):
  1. Stage 1: Single line with small shrink (from start size down to oneLineFloor in 0.1 mm steps; do not wrap).
  2. Stage 2: Split/wrap at spaces across maxLines (from start down to min size; word wider than box triggers shrink; force-broken by characters only at min size).
  3. Stage 3: Truncate last line with ellipsis ("...") at min size, returning status "truncated".
  4. Add optional `oneLineFloor` (pt) to text element schema (between start and min size).
- D-21: Validator context and decor flag (17 October 2026):
  1. `validate(scene, context = {})` accepts an optional second argument `{ card, brand, font, person, event, theme }` so that calling `validate(scene)` with 1 argument works without crashing.
  2. Added optional `decor: boolean` flag to block elements and scene nodes to separate content from decorative elements (`OVERLAP` ignores decor elements). Person B and Person C must be informed.
- Published Core Function Signatures (16 October 2026):
  - `renderCard(input)` -> `{ svg, scene, issues }`
  - `validate(scene, context?)` -> `issues`
  - `applyOperation(design, op)` -> `design`
  - `pickThree(eligible, hints = [], excludedGroups = [])` -> `looks`
