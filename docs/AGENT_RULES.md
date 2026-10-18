# Agent rules (read this first, every session)

## Project
- ACM NIT Surat design studio: generates print-ready ID cards for club events.
- Full spec: docs/knowledge-base.md. Use its field names and decisions exactly. Where the spec's section 9.9 or the code disagree with older parts of the spec, 9.9 and the code win.
- The person running you is a student. Explain things simply.

## Who is running you (ask first)
This file is shared by the whole team. At the START of every session, ask: "Are you Person A or Person C?" (Person B if they ever return) and work only in that person's folders.

| Person | Role | Folders you may edit |
|---|---|---|
| A | owns core/ and, because Person B is unavailable, server/. Temporarily also content/, assets/, docs/ and scripts/ | core/, server/, content/, assets/, docs/, scripts/ |
| C | owns client/ (the frontend) | client/ (and its own tests) |
| B | owns server/ (unreliable; Person A covers server/ until B delivers) | server/ |

- Never edit a folder that belongs to another person. If your task needs a change there, stop and tell the user what is needed and why, so they can pass it on.
- Both of you share one repo. Before starting, check git status and tell the user if you see changes you did not make. Never overwrite or reformat another person's files.
- docs/ is shared reading for everyone. Only Person A's agent edits docs/knowledge-base.md and this file. Person C's agent may add notes about client/ to docs/PROGRESS.md under its own heading.

## Hard rules
1. Plain JavaScript with ES modules. No TypeScript. Use // @ts-check and JSDoc in core/ files.
2. Zod for all schemas. Vitest for tests. Every function gets tests, including bad-input cases.
3. Do not add any library without asking first and explaining why.
4. The AI never draws or writes geometry (D-01, D-17, D-31). Layouts are composed by pure code from curated, parameterised generators (core/composer.js). core/ is pure functions: no network, database, file-system, Math.random or Date.now (the seed is passed in). The AI may only give style hints.
5. English / Latin script only.
6. Schemas and function signatures: EventSpec, Person, Brand kit, Skeleton, Block, Look, SceneNode, Issue, Operation, renderCard, validate and applyOperation are frozen (D-19). composeDrafts and draftsFor are NOT frozen (see KB 9.9). Allowed changes: new OPTIONAL fields only (additive). Do not rename or remove fields without asking. Current additive fields: decor, optional, plate, oneLineFloor, palette, Look.seed, Look.attributes.archetype / modeFallback / mode / strategy / typography, clip, stroke, strokeWidth. List any new one you add in docs/PROGRESS.md so Persons B and C are told.
7. Never push to git yourself. Show the changes and a suggested commit message.
8. client/ and server/ talk only through the API contract in docs/FRONTEND_NOTES.md. client/ must use renderCard from core/index.js for previews (D-04, one renderer) and must never copy rendering, text-fitting or validation logic.
9. Never ask the user to paste secrets (API keys, connection strings). Secrets live only in .env, which is never committed.

## How to work with me
- Before each new task, tell me in a few simple sentences WHAT we are doing and WHY it matters.
- Then show a short plan (the files you will create or change) and WAIT for my OK.
- After finishing, explain each file in plain words, tell me how to run the tests, and what to check by hand.
- If the knowledge base is unclear or contradicts itself, ask me instead of guessing.
- One task at a time. Stop after each one.

## Session routine
- At the START of every session: read this file and docs/PROGRESS.md, ask who is running you, then tell me where we are.
- At the END of every task: update docs/PROGRESS.md (see its rules) before you say the task is finished.
- If PROGRESS.md and the knowledge base disagree, tell me. For decisions, the knowledge base register (Part 0.3) is the reference.

## Design rules (every look and every change)
- Clean: one idea per card, generous whitespace, at most 2 palette colours plus neutrals.
- Hierarchy: the name is the biggest and most readable element, the role second, everything else quiet. The role must be recognisable in grayscale (a label or shape, not colour alone).
- Type: name in a bold heading face, 13 to 16 pt, fitting down to 9 pt; role text at least 7 pt bold capitals; NO text below 5.5 pt anywhere, autofix included (D-32 overrides D-22). The event name is never truncated.
- Spacing: 3 mm safe margin; spacing steps of 1, 2, 3 or 4 mm; at least 2 mm between stacked blocks; align to shared edges or the centre axis; no near-miss alignments.
- Print-safe: no lines under 0.3 mm, no very light greys, no transparency, text kept inside its box (D-20 rules). All text is drawn as path outlines (D-28).
- Works with any palette and any role colour; text colours must pass the contrast check.
- The validator catches errors, not taste: every design change must be reviewed in the gallery by a person before it counts as done. Use scripts/preview-drafts.js (drafts.html) for the composer. scripts/preview-gallery.js shows only the old six looks and is legacy.
- Design is frozen except for real errors until the pipeline (Stage A) works end to end.