# Adding Content to the Studio

This guide explains how to add new skeletons, blocks, themes, and looks to the design library without changing any code (spec 9.4). All design templates live as pure JSON files inside the `content/` folder.

---

## 1. Adding a Skeleton

A skeleton defines the physical dimensions of the card and named slots where blocks sit.

1. Create a new file in `content/skeletons/<skeleton-id>.json`.
2. Provide:
   - `id`: unique skeleton name (e.g. `"portrait"`).
   - `size`: `{ "w": number, "h": number }` in millimeters (e.g. CR80 is `54` x `85.6` mm).
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
   - `id`: unique block name (e.g. `"header.solid"` or `"info.centered"`).
   - `slot`: the skeleton slot this block belongs to (e.g. `"header"`).
   - `elements`: array of element objects.
3. Element coordinates:
   - All `box` values `[x, y, w, h]` are in **percent (0-100)** of the parent slot.
   - Dynamic values start with `$` (e.g. `"$role.color"`, `"$brand.logo.primary"`).
   - Text elements use `bind` to link data (e.g. `"person.name"`, `"role.label"`).
   - Font sizes `size: [maxPt, minPt]` are in typographic points (1 pt = 0.3528 mm).
   - Add optional flags when needed: `decor: true` (decorative element) and `optional: true` (can be hidden by autofix if overlapping).

### Example
```json
{
  "id": "header.solid",
  "slot": "header",
  "elements": [
    {
      "id": "band",
      "type": "rect",
      "box": [0, 0, 100, 100],
      "fill": "$role.color",
      "decor": true
    },
    {
      "id": "logo1",
      "type": "image",
      "src": "$brand.logo.primary",
      "box": [6, 15, 38, 70],
      "fit": "contain",
      "anchor": "left"
    }
  ]
}
```

---

## 3. Adding a Theme

A theme sets the color palette and font families for a design.

1. Create a new file in `content/themes/<theme-id>.json`.
2. Provide:
   - `id`: unique theme identifier (e.g. `"brand-blue"`).
   - `colors`: `{ "background": hex, "text": hex, "accent": hex or "$brand.palette.primary" }`.
   - `fonts`: `{ "heading": font name or "$brand.fonts.heading", "body": font name or "$brand.fonts.body" }`.

### Example
```json
{
  "id": "brand-blue",
  "colors": {
    "background": "#FFFFFF",
    "text": "#111827",
    "accent": "$brand.palette.primary"
  },
  "fonts": {
    "heading": "$brand.fonts.heading",
    "body": "$brand.fonts.body"
  }
}
```

---

## 4. Adding a Look

A look is a tested recipe that combines one skeleton, one theme, and one chosen block per slot.

1. Create a new file in `content/looks/<look-id>.json`.
2. Provide:
   - `id`: unique look name (e.g. `"look.bold"`).
   - `skeleton`: skeleton ID to use.
   - `theme`: theme ID to use.
   - `blocks`: map from each skeleton slot to a chosen block ID.
   - `attributes`: structural tags (`skeleton`, `header`, `photo`, `marker`, `theme`) used for diversity scoring.
   - `tags`: style keywords (e.g. `["bold", "tech", "energetic"]`).
   - `requires`: compatibility constraints (`orientation`, `maxRoles`, `needsPhotoSlot`).

### Example
```json
{
  "id": "look.bold",
  "skeleton": "portrait",
  "theme": "brand-blue",
  "blocks": {
    "header": "header.solid",
    "photo": "photo.rounded",
    "info": "info.centered",
    "roleMarker": "marker.bottom-bar"
  },
  "attributes": {
    "skeleton": "portrait",
    "header": "solid",
    "photo": "rounded",
    "marker": "bottom-bar",
    "theme": "blue"
  },
  "tags": ["bold", "tech", "energetic"],
  "requires": {
    "orientation": ["portrait"],
    "maxRoles": 6,
    "needsPhotoSlot": false
  }
}
```

---

## 5. Testing Content

Whenever you add or change JSON files in `content/`:

1. **Verify schemas & cross-references**:
   ```bash
   npx vitest run core/content.test.js
   ```
   This ensures:
   - Every file matches its Zod schema.
   - All skeleton, theme, and block IDs referenced by looks actually exist.
   - Every block's slot matches the skeleton's slot definition.
   - Golden SVG output remains unchanged.

2. **Preview a card visually**:
   ```bash
   node scripts/preview-card.js personNormal
   ```
   This renders `card-personNormal.svg` using the loaded content.
