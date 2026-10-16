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
  - 6 unit tests passed in `core/renderCard.test.js` (49 total tests passing in `npx vitest run`).

## In progress
- (none)

## Next
- Task 4: text measuring, wrapping and fitting with opentype.js and a bundled Latin font (Section 10.6).

## Decisions and open questions
- D-17: layouts are pre-made
- D-19: schemas and function signatures frozen in week 1
- Published Core Function Signatures (16 October 2026):
  - `renderCard(input)` -> `{ svg, scene, issues }`
  - `validate(scene)` -> `issues`
  - `applyOperation(design, op)` -> `design`
  - `pickThree(eligible, hints = [], excludedGroups = [])` -> `looks`
