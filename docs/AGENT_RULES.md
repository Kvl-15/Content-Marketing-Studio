# Agent rules (read this first, every session)

## Project
- ACM NIT Surat design studio: generates print-ready ID cards for club events.
- Full spec: docs/knowledge-base.md. Use its field names and decisions exactly. Where the spec's section 9.9 or the code disagree with older parts of the spec, 9.9 and the code win. For decisions, the register in Part 0.3 is the reference (D-37 is the team split, D-38 is the API contract rule).
- The person running you is a student. Explain things simply.

## Who is running you (ask first)
This file is shared by the whole team. At the START of every session, ask: "Are you Person A, Person B or Person C?" and work only in that person's folders.

| Person | Owns | Folders you may edit | Your progress file |
|---|---|---|---|
| A | core/ (schemas, renderer, text fit, validator, autofix, composer, picker, draftsFor, operations, undo/redo, snapping, print-sheet layout core/sheet.js), content/, assets/ (fonts, logos), scripts/, fixtures/, docs/ | core/, content/, assets/, scripts/, fixtures/, docs/ | docs/PROGRESS.md |
| B | server/: data pipeline (CSV, photos, IDs, QR), AI gateway and intake, preflight, export, state machine, storage (MongoDB), API, privacy test | server/ and its tests, plus its own progress file | docs/PROGRESS_B.md |
| C | client/: the frontend (screens, mock mode, previews, properties panel screen) | client/ and its tests, plus its own progress file | docs/PROGRESS_C.md |

- Never edit a folder that belongs to another person. If your task needs a change there (for example a new field in core/ or a missing function), STOP and tell the user exactly what is needed and why, so they can pass it on to the owner.
- Exception for docs/: every agent may create and edit its own progress file listed above. Only Person A's agent edits the rest of docs/ (knowledge-base.md, AGENT_RULES.md, API_CONTRACT.md, FRONTEND_NOTES.md, ADDING_CONTENT.md, PROGRESS.md).
- Root files (package.json, the lockfile, .gitignore, .env.example, test config): any agent may add an approved dependency (see rule 3) or a config line that its own folder needs, with the user's OK. Tell the user, and record it in your progress file. Change nothing else at the root without telling Person A.
- Tests live next to the code they test (core/, server/, client/). Each person runs their own tests, and nobody commits with a failing test.
- All three people share one repo. Before starting: check git status and pull, and tell the user if you see changes you did not make. Work on the person's own branch. Never overwrite or reformat another person's files.
- The coding agent of A or B never touches client/.

## Hard rules
1. Plain JavaScript with ES modules. No TypeScript. Use // @ts-check and JSDoc in core/ files.
2. Zod for all schemas and for everything that crosses a boundary (API requests, CSV rows, AI output, database writes). Vitest for tests. Every function gets tests, including bad-input cases.
3. Do not add any library without asking the user first and explaining why. Already approved in the knowledge base (Part 4), no need to ask: zod, vitest, opentype.js (core/); express, mongoose, papaparse, xlsx (SheetJS), sharp, qrcode, puppeteer, archiver (server/); react, vite (client/). Anything else needs approval, including the Gemini SDK, upload middleware and any CSS library.
4. The AI never draws or writes geometry (D-01, D-17, D-31). Layouts are composed by pure code from curated, parameterised generators (core/composer.js). core/ is pure functions: no network, database, file-system, Math.random or Date.now (the seed is passed in). The AI may only give style hints.
5. English / Latin script only.
6. Schemas and function signatures: EventSpec, Person, Brand kit, Skeleton, Block, Look, SceneNode, Issue, Operation, renderCard, validate and applyOperation are frozen (D-19). composeDrafts and draftsFor are NOT frozen (see KB 9.9). Allowed changes: new OPTIONAL fields only (additive), made by Person A's agent only. Do not rename or remove fields. Current additive fields: decor, optional, plate, oneLineFloor, palette, Look.seed, Look.attributes.archetype / modeFallback / mode / strategy / typography, clip, stroke, strokeWidth. Person A lists any new one in docs/PROGRESS.md and tells B and C. Person B or C who needs a new field asks Person A (see "Never edit a folder").
7. Never push to git yourself. Show the changes and a suggested commit message. Never force-push.
8. The API contract is docs/API_CONTRACT.md (written by Person A, D-38). server/ implements it and client/ consumes it. If an endpoint, field or error shape you need is missing from the contract, STOP and tell the user. Do not invent it. A contract change needs A, B and C to agree,