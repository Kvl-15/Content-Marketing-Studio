// @ts-check
/**
 * @module core/schemas
 * Zod schemas for every data shape in the knowledge base (Parts 5, 11, 12).
 * Frozen after week 1 (D-19). Do not rename fields without whole-team approval.
 *
 * All geometry is in millimeters (D-05) unless noted otherwise.
 * Block element boxes are in percent of their slot.
 * Font sizes in block elements are in typographic points (1 pt = 0.3528 mm).
 */
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════

/** Hex color string, e.g. "#2563EB". */
export const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

/**
 * [x, y, w, h] number tuple.
 * In skeletons: millimeters on the card.
 * In block elements: percent of the slot.
 */
export const BoxTuple = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/** Box object in millimeters, used in the scene graph (5.5). */
export const Box = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

// ═══════════════════════════════════════════════════════════════════════
//  Provenance (D-13, 5.1)
// ═══════════════════════════════════════════════════════════════════════

/** Provenance status – where in the workflow a value is. */
export const ProvenanceStatus = z.enum([
  "unknown",   // not yet provided
  "provided",  // has a value from the user or import
  "declined",  // user chose to skip
  "defaulted", // filled from a default
]);

/** Provenance source – how a value was obtained. */
export const ProvenanceSource = z.enum([
  "brief",      // extracted from the free-text request
  "answer",     // user answered a question
  "default",    // system default
  "suggestion", // AI suggestion (must be confirmed before printing)
  "import",     // imported from CSV or other file
]);

/**
 * Wraps a value schema with provenance metadata.
 * Every value that can come from the user or AI stores status, source
 * and confirmed (D-13). Unconfirmed suggestions never reach a printed card.
 *
 * @param {import("zod").ZodTypeAny} valueSchema – the inner value type
 */
export function provenanceField(valueSchema) {
  return z.object({
    value:     valueSchema.nullable(),
    status:    ProvenanceStatus,
    source:    ProvenanceSource.optional(),
    confirmed: z.boolean().optional(),
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  EventSpec (5.1)
// ═══════════════════════════════════════════════════════════════════════

/** One role in the event (participant, mentor, organizer, …). */
export const RoleSpec = z.object({
  id:            z.string().min(1),
  label:         z.string().min(1),
  expectedCount: z.number().int().min(0),
  color:         provenanceField(HexColor),
});

/** Card physical dimensions and print settings. CR80 default: 54 × 85.6 mm. */
export const CardSettings = z.object({
  widthMm:      z.number().positive(),
  heightMm:     z.number().positive(),
  orientation:  z.enum(["portrait", "landscape"]),
  bleedMm:      z.number().min(0),
  safeMarginMm: z.number().min(0),
  sides:        z.enum(["front", "back", "both"]),
});

/** QR code settings for check-in URLs. */
export const QrSettings = z.object({
  enabled:    z.boolean(),
  urlPattern: z.string(),
});

/**
 * The full event specification with provenance on every user-facing value.
 * schemaVersion is always 1 for this version of the tool.
 */
export const EventSpec = z.object({
  schemaVersion: z.literal(1),
  designType:    z.enum(["id-card"]),
  event: z.object({
    name:    provenanceField(z.string()),
    tagline: provenanceField(z.string()),
    venue:   provenanceField(z.string()),
    dates:   provenanceField(z.array(z.string())),
    palette: z.array(HexColor).min(1).max(3).optional(),
  }),
  roles:  z.array(RoleSpec).min(1),
  fields: provenanceField(z.array(z.string())),
  card:   CardSettings,
  qr:     QrSettings,
});

// ═══════════════════════════════════════════════════════════════════════
//  Person (5.2)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Known person flags. The flags array accepts any string so the data
 * pipeline can add new flags without a schema change.
 */
export const KNOWN_PERSON_FLAGS = /** @type {const} */ ([
  "LONG_NAME",
  "NO_PHOTO",
  "DUPLICATE_ID",
]);

/** One row from the participant dataset. */
export const Person = z.object({
  id:         z.string().min(1),
  name:       z.string().min(1),
  roleId:     z.string().min(1),
  org:        z.string().optional(),
  email:      z.string().optional(),
  photo:      z.string().nullable(),
  checkinUrl: z.string().optional(),
  flags:      z.array(z.string()),
});

// ═══════════════════════════════════════════════════════════════════════
//  BrandKit (5.3)
// ═══════════════════════════════════════════════════════════════════════

/** Placement rules for one logo (minimum size, clear space). */
export const LogoSpec = z.object({
  file:          z.string().min(1),
  minWidthMm:    z.number().positive(),
  clearSpaceMm:  z.number().min(0),
  dataUri:       z.string().optional(),
  width:         z.number().positive().optional(),
  height:        z.number().positive().optional(),
});

/**
 * Official branding for a club or organization.
 * Palette and font values are placeholders until confirmed (OQ-08).
 */
export const BrandKit = z.object({
  id:      z.string().min(1),
  name:    z.string().min(1),
  logos: z.object({
    primary:   LogoSpec,
    secondary: LogoSpec,
  }),
  palette: z.object({
    primary:   z.string(),
    secondary: z.string(),
    dark:      z.string(),
    light:     z.string(),
  }),
  fonts: z.object({
    heading: z.string(),
    body:    z.string(),
  }),
  qrDefaultUrl: z.string(),
});

// ═══════════════════════════════════════════════════════════════════════
//  Skeleton (5.4)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Card structure with named slots.
 * Slot positions are [x, y, w, h] in millimeters.
 */
export const Skeleton = z.object({
  id:   z.string().min(1),
  size: z.object({
    w: z.number().positive(),
    h: z.number().positive(),
  }),
  slots:    z.record(z.string(), BoxTuple),
  supports: z.object({
    orientation: z.array(z.enum(["portrait", "landscape"])).min(1),
    photo:       z.boolean(),
    qr:          z.boolean(),
  }),
});

// ═══════════════════════════════════════════════════════════════════════
//  Block & BlockElement (5.4)
// ═══════════════════════════════════════════════════════════════════════

/** Rect element inside a block. */
export const RectBlockElement = z.object({
  id:     z.string().min(1),
  type:   z.literal("rect"),
  box:    BoxTuple,
  fill:   z.string(),
  radius: z.number().min(0).optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().positive().optional(),
  decor:  z.boolean().optional(),
  optional: z.boolean().optional(),
});

/** Image element inside a block (logos, photos). */
export const ImageBlockElement = z.object({
  id:     z.string().min(1),
  type:   z.literal("image"),
  box:    BoxTuple,
  src:    z.string(),
  fit:    z.enum(["contain", "cover"]).optional(),
  anchor: z.enum(["left", "right", "center"]).optional(),
  clip:   z.enum(["circle", "rounded", "square"]).optional(),
  decor:  z.boolean().optional(),
  optional: z.boolean().optional(),
  plate:  z.union([
    z.object({
      fill: z.string().optional(),
      radiusMm: z.number().optional(),
      paddingMm: z.number().optional(),
    }),
    z.literal("auto"),
    z.literal("shared"),
  ]).optional(),
});

/**
 * Text element inside a block.
 * size is [maxPt, minPt] in typographic points.
 * The renderer converts to mm: 1 pt = 0.3528 mm.
 */
export const TextBlockElement = z.object({
  id:           z.string().min(1),
  type:         z.literal("text"),
  box:          BoxTuple,
  bind:         z.string(),
  font:         z.string(),
  size:         z.tuple([z.number().positive(), z.number().positive()]),
  oneLineFloor: z.number().positive().optional(),
  maxLines:     z.number().int().positive(),
  align:        z.enum(["left", "center", "right"]),
  decor:        z.boolean().optional(),
  optional:     z.boolean().optional(),
}).refine(
  (data) => {
    if (data.oneLineFloor === undefined) return true;
    return data.oneLineFloor <= data.size[0] && data.oneLineFloor >= data.size[1];
  },
  {
    message: "oneLineFloor must be between start size and minimum size",
  }
);

/** Any element inside a block (discriminated on "type"). */
export const BlockElement = z.discriminatedUnion("type", [
  RectBlockElement,
  ImageBlockElement,
  TextBlockElement,
]);

/**
 * Swappable part that fills one skeleton slot.
 * Element boxes are in percent of the slot.
 */
export const Block = z.object({
  id:       z.string().min(1),
  slot:     z.string().min(1),
  elements: z.array(BlockElement).min(1),
});

// ═══════════════════════════════════════════════════════════════════════
//  Theme (5.4)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Colors and fonts for a design.
 * Values may be literal (e.g. "#FFFFFF") or $ placeholders
 * resolved at render time (e.g. "$brand.palette.primary").
 */
export const Theme = z.object({
  id: z.string().min(1),
  colors: z.object({
    background: z.string(),
    text:       z.string(),
    accent:     z.string(),
  }),
  fonts: z.object({
    heading: z.string(),
    body:    z.string(),
  }),
});

// ═══════════════════════════════════════════════════════════════════════
//  Look (5.4)
// ═══════════════════════════════════════════════════════════════════════

/**
 * A tested recipe: one skeleton, one block per slot, one theme,
 * plus attributes for scoring and requirements for filtering.
 */
export const Look = z.object({
  id:       z.string().min(1),
  skeleton: z.string().min(1),
  theme:    z.string().min(1),
  blocks:   z.record(z.string(), z.string()),
  attributes: z.object({
    skeleton:   z.string(),
    header:     z.string(),
    photo:      z.string(),
    marker:     z.string(),
    theme:      z.string(),
    mode:       z.enum(["light", "dark", "colour-field"]).optional(),
    strategy:   z.enum(["event-led", "role-led"]).optional(),
    typography: z.string().optional(),
    archetype:  z.string().optional(),
  }),
  tags: z.array(z.string()),
  requires: z.object({
    orientation:    z.array(z.enum(["portrait", "landscape"])).min(1),
    maxRoles:       z.number().int().positive(),
    needsPhotoSlot: z.boolean(),
  }),
  seed: z.union([z.string(), z.number()]).optional(),
});

// ═══════════════════════════════════════════════════════════════════════
//  SceneNode (5.5)
// ═══════════════════════════════════════════════════════════════════════

/** Rendered rectangle in the scene graph. */
export const RectNode = z.object({
  type:   z.literal("rect"),
  id:     z.string(),
  box:    Box,
  fill:   z.string(),
  radius: z.number().min(0).optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().positive().optional(),
  clip:   z.enum(["circle", "rounded", "square"]).optional(),
  photoMode: z.enum(["silhouette", "initials"]).optional(),
  initials: z.string().optional(),
  decor:  z.boolean().optional(),
  optional: z.boolean().optional(),
});

/** Rendered image (logo, photo) in the scene graph. */
export const ImageNode = z.object({
  type:  z.literal("image"),
  id:    z.string(),
  box:   Box,
  href:  z.string(),
  srcW:  z.number().positive(),
  srcH:  z.number().positive(),
  clip:  z.enum(["circle", "rounded"]).optional(),
  plate: z.union([
    z.object({
      fill: z.string().optional(),
      radiusMm: z.number().optional(),
      paddingMm: z.number().optional(),
    }),
    z.literal("auto"),
    z.literal("shared"),
  ]).optional(),
  decor: z.boolean().optional(),
  optional: z.boolean().optional(),
});

/** Rendered text in the scene graph. */
export const TextNode = z.object({
  type:   z.literal("text"),
  id:     z.string(),
  box:    Box,
  lines:  z.array(z.string()),
  sizeMm: z.number().positive(),
  font:   z.string(),
  fontRole: z.enum(["heading", "body"]).optional(),
  fill:   z.string(),
  anchor: z.enum(["start", "middle", "end"]),
  status: z.enum(["ok", "truncated"]),
  decor:  z.boolean().optional(),
  optional: z.boolean().optional(),
  bind:   z.string().optional(),
});

/** Rendered path (QR code, text outlines) in the scene graph. */
export const PathNode = z.object({
  type:  z.literal("path"),
  id:    z.string(),
  box:   Box,
  d:     z.string(),
  fill:  z.string(),
  decor: z.boolean().optional(),
  optional: z.boolean().optional(),
});

/** Any node in the scene graph (discriminated on "type"). */
export const SceneNode = z.discriminatedUnion("type", [
  RectNode,
  ImageNode,
  TextNode,
  PathNode,
]);

// ═══════════════════════════════════════════════════════════════════════
//  Issue (5.5, 11.1)
// ═══════════════════════════════════════════════════════════════════════

/** All validator check codes from Part 11.1. */
export const IssueCode = z.enum([
  "TEXT_TRUNCATED",
  "TEXT_OVERFLOW",
  "TEXT_UNSUPPORTED_GLYPH",
  "OVERLAP",
  "LOGO_DISTORTED",
  "LOGO_CLEARSPACE",
  "LOGO_TOO_SMALL",
  "LOGO_MISSING",
  "OUTSIDE_SAFE_MARGIN",
  "LOW_CONTRAST",
  "QR_TOO_SMALL",
  "UNFILLED_DATA",
  "UNCONFIRMED_VALUE",
  "PHOTO_LOW_RES",
  "NO_PHOTO",
  "EVENT_NAME_DOES_NOT_FIT",
  "UNKNOWN_ROLE_ID",
]);

/**
 * One validation issue found by the validator.
 * Errors block export (D-09). Warnings need user acknowledgement.
 */
export const Issue = z.object({
  severity: z.enum(["error", "warning"]),
  code:     IssueCode,
  nodeId:   z.string().optional(),
  message:  z.string(),
});

// ═══════════════════════════════════════════════════════════════════════
//  DesignConfig (5.6)
// ═══════════════════════════════════════════════════════════════════════

/** Per-role style overrides (color, marker). */
export const RoleStyleOverride = z.object({
  color:  HexColor.optional(),
  marker: z.string().optional(),
});

/**
 * The full design configuration for rendering.
 * final design = look + theme + roleStyles + overrides
 *
 * Override layers (template → roles → people) are flexible records
 * because the set of overridable properties may grow.
 */
export const DesignConfig = z.object({
  lookId:     z.string().min(1),
  themeId:    z.string().min(1),
  roleStyles: z.record(z.string(), RoleStyleOverride).optional(),
  overrides: z.object({
    template: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    roles:    z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    people:   z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  }).optional(),
  seed: z.number().int().min(0),
});

// ═══════════════════════════════════════════════════════════════════════
//  ExportSettings (5.7)
// ═══════════════════════════════════════════════════════════════════════

/** Settings for the export module (Part 13). */
export const ExportSettings = z.object({
  format:         z.enum(["svg", "pdf", "png"]),
  mode:           z.enum(["single", "all", "sheet"]),
  sheet:          z.enum(["A4", "A3"]),
  dpi:            z.number().int().positive(),
  bleedMm:        z.number().min(0),
  cropMarks:      z.boolean(),
  sides:          z.enum(["front", "back", "both"]),
  textAsOutlines: z.boolean(),
  groupByRole:    z.boolean(),
});

// ═══════════════════════════════════════════════════════════════════════
//  Operation (12.3) — closed vocabulary, discriminated on "op"
// ═══════════════════════════════════════════════════════════════════════

export const SetDensityOp = z.object({
  op:    z.literal("setDensity"),
  value: z.enum(["airy", "normal", "compact"]),
});

export const SetHeaderStyleOp = z.object({
  op:    z.literal("setHeaderStyle"),
  value: z.enum(["solid", "diagonal", "thin-line", "none"]),
});

export const SetPhotoShapeOp = z.object({
  op:    z.literal("setPhotoShape"),
  value: z.enum(["circle", "rounded", "square"]),
});

export const SetRoleMarkerOp = z.object({
  op:     z.literal("setRoleMarker"),
  roleId: z.string().optional(),
  value:  z.enum(["bottom-bar", "side-stripe", "corner-ribbon"]),
});

export const SetPatternOp = z.object({
  op:    z.literal("setPattern"),
  value: z.enum(["none", "dots", "circuit"]),
});

/** value is a theme ID string — checked against the design later, not here. */
export const SetThemeOp = z.object({
  op:    z.literal("setTheme"),
  value: z.string().min(1),
});

export const SetAccentColorOp = z.object({
  op:     z.literal("setAccentColor"),
  roleId: z.string().optional(),
  value:  HexColor,
});

/** id and slot are checked against the design later, not here. */
export const MoveElementOp = z.object({
  op:   z.literal("moveElement"),
  id:   z.string().min(1),
  slot: z.string().min(1),
});

export const ResizeElementOp = z.object({
  op:    z.literal("resizeElement"),
  id:    z.string().min(1),
  scale: z.number().min(0.5).max(1.5),
});

export const HideElementOp = z.object({
  op: z.literal("hideElement"),
  id: z.string().min(1),
});

export const ShowElementOp = z.object({
  op: z.literal("showElement"),
  id: z.string().min(1),
});

export const SetTextOverrideOp = z.object({
  op:       z.literal("setTextOverride"),
  personId: z.string().min(1),
  field:    z.string().min(1),
  value:    z.string(),
});

/**
 * One edit operation from the closed vocabulary (Part 12.3).
 * The AI may only produce operations from this list.
 * Design-dependent values (element id, slot name, theme id) are
 * validated as strings here; the applier checks them against the design.
 */
export const Operation = z.discriminatedUnion("op", [
  SetDensityOp,
  SetHeaderStyleOp,
  SetPhotoShapeOp,
  SetRoleMarkerOp,
  SetPatternOp,
  SetThemeOp,
  SetAccentColorOp,
  MoveElementOp,
  ResizeElementOp,
  HideElementOp,
  ShowElementOp,
  SetTextOverrideOp,
]);
