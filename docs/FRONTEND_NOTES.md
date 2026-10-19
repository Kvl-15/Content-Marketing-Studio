# Frontend Notes (D-38)

These notes are for the client developer. The API contract is
`docs/API_CONTRACT.md`; this file explains the client-side rules and the
current A2 boundaries.

## 1. Non-negotiable rules

1. **One renderer.** Card preview uses `renderCard` imported from
   `core/index.js` (D-04). The GUI must not create a second renderer, copy
   SVG/layout logic, copy text fitting, or copy validation logic.
2. **No QR toggle yet.** The GUI must not offer a QR toggle until D-39 is
   done. QR is currently dropped when the minimum-size autofix path is used,
   and `ELEMENT_DROPPED` is raised. Treat that issue as visible state, not as
   a reason to invent a client-side QR implementation.
3. **Privacy.** AI never receives names, emails, participant rows, or photos
   (D-10). Only the brief, edit requests, and CSV headers may be sent when the
   server explicitly needs them.
4. **Fallback.** Every AI step has a form fallback (D-12). The GUI must stay
   usable when the AI is unavailable or returns invalid data.
5. **Imported IDs are sacred.** IDs from the CSV are kept as-is. The client
   must not reformat, uppercase, regenerate, or replace an imported ID.
6. **No guessed API fields.** If `docs/API_CONTRACT.md` marks an endpoint or
   field PLANNED, keep the client flow behind mock data in `client/` until the
   server publishes the real shape.

## 2. Core preview contract

Import the shared renderer:

```js
import { renderCard } from "../core/index.js";

const result = renderCard({
  skeleton,
  blocks,
  theme,
  look,
  person,
  event,
  brand,
  fonts,
  card,
});
```

The **REAL** result is:

```js
{
  svg,
  scene,
  issues,
  fixes,
  trimBox,
  bleedBox,
  bleedMm,
}
```

Use `result.svg` for the preview and `result.issues` for visible diagnostics.
Do not turn a warning into a client error, and do not hide an error by
reimplementing the validator.

`SceneNode` uses millimetre boxes. Text is rendered as paths by the core
renderer. The current issue codes include `TEXT_TRUNCATED`, `TEXT_OVERFLOW`,
`TEXT_UNSUPPORTED_GLYPH`, `OVERLAP`, `LOGO_DISTORTED`, `LOGO_CLEARSPACE`,
`LOGO_TOO_SMALL`, `LOGO_MISSING`, `OUTSIDE_SAFE_MARGIN`, `LOW_CONTRAST`,
`QR_TOO_SMALL`, `UNFILLED_DATA`, `UNCONFIRMED_VALUE`, `PHOTO_LOW_RES`,
`NO_PHOTO`, `EVENT_NAME_DOES_NOT_FIT`, `UNKNOWN_ROLE_ID`, and
`ELEMENT_DROPPED`.

## 3. EventSpec and people

`roles` is at `eventSpec.roles`:

```js
const role = eventSpec.roles.find((item) => item.id === person.roleId);
```

The complete EventSpec shape and example are in the API contract. Important
client facts:

- A role has `id`, `label`, `expectedCount`, and a provenance-wrapped `color`.
- A `Person` has `id`, `name`, `roleId`, optional `org`/`email`, nullable
  `photo`, optional `checkinUrl`, and `flags`.
- `roleId` must match a role id exactly for rendering and validation.
- Event counts are expectations only; people come from the uploaded dataset.
- Names are English/Latin-script only under the current project rules.

## 4. Drafts

The current core function returns the top-level shape below. The `issues`
member is part of the result even when it is empty:

```js
import { composeDrafts } from "../core/index.js";

const result = composeDrafts(eventSpec, {
  seed: 42,
  count: 3,
  previousArchetypes: [],
  previousSeeds: [],
});

// result = { drafts, seed, issues }
```

Each draft contains the composed `skeleton`, `blocks`, `theme`, and `look`,
plus `seed`, `archetype`, `score`, and `scoreDetails`. The current composer
may also return `scene`, `svg`, `modeFallback`, `fonts`, and draft-level
`issues`.

When the server returns the contract error `NO_VALID_DRAFT`, show a useful
empty state and keep the form/manual route available. Do not manufacture a
placeholder draft.

To preview a saved draft again, pass its saved design bundle to `renderCard`.
Do not call `composeDrafts` just to redraw the same draft.

## 5. A2 upload report

The data upload success body is:

```js
{ people, report }
```

The report is the real A2 report, including:

- detected `format`, optional XLSX `firstSheet`, optional `delimiter`,
  `headerRow`, and original `headers`;
- mapping proposals with columns, confidence, competing candidates, unmapped
  headers, and missing required fields;
- one row status (`OK`, `WARNING`, or `ERROR`) and its issue entries per row;
- totals, formula-like-cell count, matched photo records, unmatched photo
  files, unmatched rows, long-name measurement, and enforced limits.

Use the report to build the mapping confirmation and problem-row screens. Row
issue entries are not the same object as the common API `error.issues` list;
preserve their source fields and codes.

For upload failures, read the common API error envelope. The real A2 typed
codes include `UNSUPPORTED_FORMAT`, `PARSE_ERROR`, and `VALIDATION_ERROR`.

## 6. Error handling

Every API error has this shape:

```js
{
  error: {
    code: string,
    message: string,
    issues?: Issue[],
  },
}
```

Render results can contain `issues` without being an HTTP failure. HTTP
failures use `error`; do not look for a second error format. Display the plain
`message`, expose issue `code`s for support/debugging, and use `nodeId` when
highlighting a card element.

## 7. Export UI (E2a)

The export form must use the exact settings fields from
`core/exportSettings.js`:

```js
{
  format,
  mode,
  card: { widthMm, heightMm },
  orientation,
  dpi,
  bleedMm,
  cropMarks,
  sides,
  textAsOutlines,
  groupByRole,
  duplexFlip,
  printerSafeMm,
  sheet: {
    paper,
    widthMm,
    heightMm,
    marginMm,
    gapMm,
    markLengthMm,
    markOffsetMm,
    markStrokeMm,
    printerSafeMm,
    duplexFlip,
  },
}
```

For E2a the UI offers only one-card SVG and PNG. Do not offer PDF, sheets, or
ZIP until E2b. Do not offer landscape: the server refuses it with
`UNSUPPORTED_ORIENTATION`. The server refuses every error; it refuses
warnings unless the request sets `acknowledgedWarnings: true` (D-09).

Export file names come from `person.id` only. Never display or construct a
download filename from a name or email. The server's safe filename may use a
sanitized id or a `card` fallback.

## 8. AI and form flow

The client owns the question widgets and can operate without AI:

1. Submit a brief or choose the manual form.
2. Show extracted values with provenance and ask only for actual gaps.
3. Let the user confirm or decline optional values.
4. Save and lock a validated EventSpec.
5. Upload data and confirm the proposed mapping.
6. Show drafts, render previews through the shared core, and surface issues.

Never treat an unconfirmed suggestion as printable data. Never send a photo,
email, or participant row to the AI gateway.

## 9. Implemented versus planned

The API contract deliberately marks project storage, EventSpec patch/lock
envelopes, draft/render route envelopes, version saving, export progress, and
downloads as PLANNED where no server shape exists. Until those shapes are
published, keep the client mock local and do not infer fields from a screen or
from an old knowledge-base example.

## 10. Manual checks

- Turn off AI and complete the form path.
- Confirm roles render from `eventSpec.roles` and an unknown `roleId` shows
  `UNKNOWN_ROLE_ID`.
- Upload the messy fixture and verify the report totals, row statuses, mapping
  proposals, and photo matching lists are visible.
- Preview the same saved draft twice and verify both previews use `renderCard`.
- Confirm the E2a export controls do not show QR, PDF, sheets, ZIP, or
  landscape options, and that filenames contain IDs but not names/emails.
