# Agent rules (read this first, every session)

## Project
- ACM NIT Surat design studio: generates print-ready ID cards for club events.
- Full spec: docs/knowledge-base.md. Use its field names and decisions exactly.
- I am Person A (the owner of core/). Person B owns server/. Person C owns client/ and content/. Note (18 October 2026): Person C has been inactive, so Person A is temporarily covering Person C's areas (content/, assets/, and docs/). Keep server/ and client/ strictly off limits.
- I am a student. Explain things simply.

## Hard rules
1. Plain JavaScript with ES modules. No TypeScript. Use // @ts-check and JSDoc in core/ files.
2. Zod for all schemas. Vitest for tests. Every function gets tests, including bad-input cases.
3. Do not add any library without asking me first and explaining why.
4. The AI never designs layouts (D-17). Layouts are pre-made looks. core/ is pure functions: no network, database or file-system calls.
5. English / Latin script only.
6. Schemas and function signatures are frozen after week 1 (D-19). Do not rename fields without asking me.
7. Never push to git yourself. Show me the changes and a suggested commit message.

## How to work with me
- Before each new task, tell me in a few simple sentences WHAT we are doing and WHY it matters.
- Then show a short plan (the files you will create or change) and WAIT for my OK.
- After finishing, explain each file in plain words, tell me how to run the tests, and what to check by hand.
- If the knowledge base is unclear or contradicts itself, ask me instead of guessing.
- One task at a time. Stop after each one.

## Session routine
- At the START of every session: read this file and docs/PROGRESS.md, then tell me where we are.
- At the END of every task: update docs/PROGRESS.md (see its rules) before you say the task is finished.
