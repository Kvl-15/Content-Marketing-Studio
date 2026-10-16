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
  - Defined Zod schemas for all 12 shapes from Part 5 and Section 12.3 (EventSpec, Person, BrandKit, Skeleton, Block, Theme, Look, SceneNode, Issue, DesignConfig, ExportSettings, Operation).
  - Verified with 39 unit tests in `core/schemas.test.js` covering valid fixtures and at least two bad-input cases per schema. All 40 test suite checks passed (`npx vitest run`).

## In progress
- (none)

## Next
- Stub `renderCard` and first vertical slice: create `core/render.js` returning hardcoded SVG, scene graph, and issues so client and server can integrate immediately (D-19).

## Decisions and open questions
- D-17: layouts are pre-made
- D-19: schemas and function signatures frozen in week 1
