# Agent rules (read this first, every session)

## Project
- ACM NIT Surat design studio: generates print-ready ID cards for club events.
- Full spec: docs/knowledge-base.md. Use its field names and decisions exactly. Where the spec's section 9.9 or the code disagree with older parts of the spec, 9.9 and the code win. For decisions, the register in Part 0.3 is the reference.
- The person running you is a student. Explain things simply.

## Task scope (the most important rule)
- Several people share this repo and the split of work changes often. So the rules do NOT assign folders to people. Instead, every task I give you names the folders and files you may touch.
- Only touch what the task names. If the task does not say, ask me before editing anything. Never edit client/ unless the task is explicitly a client task.
- If you find that you need a change outside the allowed scope (a new field in core/, a missing endpoint, a root file), STOP and tell me exactly what is needed and why. Do not make the change.
- Never overwrite or reformat files you were not asked to change. Before starting, run git status and tell me about any changes you did not make.
- Root files (package.json, lockfile, .gitignore, .env.example, test config): you may add an approved dependency (see rule 3) or a config line the task needs. Tell me, and record it in the progress file. Nothing else at the root.

## Session start
At the START of every session, read this file and docs/PROGRESS.md, ask me "Which person are you (A, B or C)?", then tell me where we are in a few sentences. The answer only decides which progress file you update (see Session routine). It does NOT limit what you may edit. The task does.

## Hard rules
1. Plain JavaScript with ES modules. No TypeScript. Use // @ts-check and JSDoc in core/ files.
2. Zod for all schemas and for everything that crosses a boundary (API requests, CSV rows, AI output, database writes). Vitest for tests. Every function gets tests, including bad-input cases.
3. Do not add any library without asking me first and explaining why. Already approved in the knowledge base (Part 4), no need to ask: zod, vitest, opentype.js, express, mongoose, papaparse, xlsx (SheetJS), sharp, qrcode, puppeteer, archiver, react, vite. Anything else needs my approval, including the Gemini SDK, upload middleware and any CSS library.
4. The AI never draws or writes geometry (D-01, D-17, D-31). Layouts are composed by pure code from curated, parameterised generators (core/composer.js). core/ is pure functions: no network, database, file-system, Math.random or Date.now (the seed is passed in). The AI may only give style hints.
5. English / Latin script only.
6. Frozen schemas and signatures: EventSpec, Person, Brand kit, Skeleton, Block, Look, SceneNode, Issue, Operation, renderCard, validate and applyOperation (D-19). composeDrafts and draftsFor are not frozen (KB 9.9). Allowed changes: new OPTIONAL fields only (additive), and only when the task says so. Do not rename or remove fields. Current additive fields: decor, optional, plate, oneLineFloor, palette, Look.seed, Look.attributes.archetype / modeFallback / mode / strategy / typography, clip, stroke, strokeWidth. List any new one in the progress file.
7. Never push to git yourself. Show me the changes and a suggested commit message. Never force-push. Work on the branch I name.
8. The API contract is docs/API_CONTRACT.md (D-38). Server code implements it and client code consumes it. If an endpoint, field or error shape you need is missing from the contract, STOP and tell me. Do not invent it. Until the real endpoints exist, client code uses mock data kept inside client/.
9. Server code must call core/ functions (renderCard, validate, draftsFor, sheet layout) and never copy their logic. Client code must use renderCard from core/index.js for every card preview (D-04, one renderer) and never copy rendering, text-fitting or validation logic.
10. Never ask me to paste secrets (API keys, connection strings). Secrets live only in .env, which is never committed. Participant names, emails and photos are never sent to a cloud AI (D-10). Only brief text and CSV headers are.

## How to work with me
- Before each new task, tell me in a few simple sentences WHAT we are doing and WHY it matters.
- Then show a short plan (the files you will create or change) and WAIT for my OK.
- After finishing, explain each file in plain words, tell me how to run the tests, and what to check by hand.
- If the knowledge base is unclear or contradicts itself, list the conflict and ask me instead of guessing.
- One task at a time. Stop after each one.

## Session routine
- At the END of every task, update the progress file before you say the task is finished: Person A uses docs/PROGRESS.md, Person B uses docs/PROGRESS_B.md, Person C uses docs/PROGRESS_C.md (create it if missing). Write the done items with date and files, what is half-finished or broken, the single next task, and any decision or open question.
- Be honest: mark something done only if its tests pass, and say how you checked. Never invent numbers.
- If a progress file and the knowledge base disagree, tell me. The register in the knowledge base wins on decisions.
- Only knowledge-base.md edits that the task asks for. Never edit this file unless I ask.

## Design rules (every card look and every change in core/ or content/)
- Clean: one idea per card, generous whitespace, at most 2 palette colours plus neutrals.
- Hierarchy: the name is the biggest and most readable element, the role second, everything else quiet. The role must be recognisable in grayscale (a label or shape, not colour alone).
- Type: name in a bold heading face, 13 to 16 pt, fitting down to 9 pt; role text at least 7 pt bold capitals; NO text below 5.5 pt anywhere, autofix included (D-32 overrides D-22). The event name is never truncated.
- Spacing: 3 mm safe margin; spacing steps of 1, 2, 3 or 4 mm; at least 2 mm between stacked blocks; align to shared edges or the centre axis; no near-miss alignments.
- Print-safe: no lines under 0.3 mm, no very light greys, no transparency, text kept inside its box (D-20 rules). All text is drawn as path outlines (D-28).
- Works with any palette and any role colour; text colours must pass the contrast check.
- The validator catches errors, not taste: every card design change must be reviewed by a person in the gallery before it counts as done. Use scripts/preview-drafts.js (drafts.html) for the composer. scripts/preview-gallery.js shows only the old six looks and is legacy.
- Design is frozen except for real errors until the pipeline (Stage A) works end to end.