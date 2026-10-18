# Adding Content to the Studio

This guide explains how to add new skeletons, blocks, themes, and looks to the design library without changing any code (spec 9.4). All design templates live as pure JSON files inside the `content/` folder.

---

## 1. Adding a Skeleton

A skeleton defines the physical dimensions of the card and named slots where blocks sit.

1. Create a new file in `content/skeletons/<skeleton-id>.json`.
2. Provide:
   - `id`: unique skeleton name (e.g. `"portrait"`, `"sidebar"`, `"full-photo"`).
   - `size`: `{ "w": number, "h": number }` in millimeters (e.g. CR80 is `54` × `85.6` mm).
   - `slots`: object mapping slot names (`header`, `photo`, `info`, `roleMarker`, etc.) to `[x, y, w, h]` box coordinates in **millimeters** from top-left.
   - `supports`: `{ "orientation": ["portrait" | "landscape"], "photo": boolean, "qr": boolean }`.

### Example
```json
{
  "id": "portrait",
  "size": { "w": 54, "h": 85.6 },
  "slots": {
    "header": [0, 0, 54, 26],
    "photo": [13, 22, 28, 34],
    "info": [4, 58, 46, 18],
    "roleMarker": [0, 78, 54, 7.6]
  },
  "supports": {
    "orientation": ["portrait"],
    "photo": true,
    "qr": true
  }
}
```

---

## 2. Adding a Block

A block fills one specific skeleton slot with visual elements (rectangles, images, text, or paths).

1. Create a new file in `content/blocks/<block-id>.json`.
2. Provide:
   - `id`: unique block name (e.g. `"header.solid"`, `"header.thin-line"`, `"info.centered"`).
   - `slot`: the skeleton slot this block belongs to (e.g. `"header"`, `"photo"`, `"info"`, `"roleMarker"`).
   - `elements`: array of element objects.
3. Element coordinates:
   - All `box` values `[x, y, w, h]` are in **percent (0-100)** of the parent slot.
   - Dynamic values start with `$` (e.g. `"$role.color"`, `"$theme.colors.accent"`).
   - Text elements use `bind` to link data (e.g. `"person.name"`, `"role.label"`).
   - Font sizes `size: [maxPt, minPt]` are in typographic points (1 pt = 0.3528 mm).
   - Flags: Mark backgrounds, bands, stripes, lines and ribbons `decor: true`. Set `optional: true` for decorative elements that may be hidden by autofix if overlapping.
   - Logo plates: Set `plate: "auto"` or `plate: { fill, radiusMm, paddingMm }` on logo image elements to automatically draw a protective white background plate behind the logo on dark or saturated backgrounds (D-29).

---

## 3. Themes and Theme Derivation (D-24)

Themes can be pre-authored in `content/themes/<theme-id>.json` or dynamically derived from an event's 1–3 color palette by pure code (`core/themeDerivation.js`):
- `light`: white/tinted background with guaranteed high-contrast dark text ($\ge 4.5:1$).
- `dark`: slate-900 background with crisp white text ($\ge 4.5:1$).
- `colour-field`: dynamic background using the primary event color, with text automatically switching between white and near-black based on relative luminance.

---

## 4. Adding a Look

A look is a tested recipe that combines one skeleton, one theme, and one chosen block per slot.

1. Create a new file in `content/looks/<look-id>.json`.
2. Provide:
   - `id`: unique look name (e.g. `"look.minimal"`).
   - `skeleton`: skeleton ID to use.
   - `theme`: theme ID to use (or default theme name).
   - `blocks`: map from each skeleton slot to a chosen block ID.
   - `attributes`: structural tags (`skeleton`, `header`, `photo`, `marker`, `theme`, plus optional `mode`, `strategy`, `typography`) used for diversity scoring.
   - `tags`: style keywords (e.g. `["minimal", "clean", "spacious"]`).
   - `requires`: compatibility constraints (`orientation`, `maxRoles`, `needsPhotoSlot`).

---

## 5. Declarative Compatibility Rules (spec 9.5)

Add disallowed combinations or role limits to `content/compatibility.json`:
- `disallowedCombinations`: rules preventing incompatible block and skeleton combinations (e.g. `full-photo` cannot use heavy `header.solid`).
- `maxRolesLimits`: role capacity limits per look.

---

## 6. Testing & Visual Verification

1. **Verify schemas, references, and stress tests**:
   ```bash
   npx vitest run core/content.test.js
   ```
   Runs:
   - Schema validation across all JSON files in `content/`.
   - Cross-reference integrity.
   - Declarative compatibility checks.
   - Distinctness distance rule verification ($\ge 5$ across two non-overlapping groups of 3).
   - Stress test: 6 looks × 200 random palettes × 3 persons (zero validator errors).

2. **Generate and inspect visual gallery**:
   ```bash
   node scripts/preview-gallery.js
   ```
   Generates `gallery.html` showing a full matrix of looks against multiple real-world color palettes. Open `gallery.html` in any browser.
