// @ts-check
import { z } from "zod";
import { deriveTheme } from "./themeDerivation.js";
import { FONT_PAIRINGS, sampleModeForPalette } from "./composer.js";

/**
 * @module core/designEngine
 * Pure generative card design engine with motif layer (Task E1).
 * Pure functions only: no Math.random, Date.now, file or network I/O.
 */

// ═══════════════════════════════════════════════════════════════════════
//  1. DesignSpec Schema
// ═══════════════════════════════════════════════════════════════════════

export const GridEnum = z.enum([
  "stack-left-art-right",
  "stack-left-art-bottom",
  "stack-centre-art-corners",
  "name-first",
  "photo-large",
]);

export const PhotoShapeEnum = z.enum(["square", "rounded", "circle"]);
export const PhotoSizeEnum = z.enum(["S", "M", "L"]);
export const AccentEnum = z.enum(["edge-bar-left", "edge-bar-right", "corner-block", "bottom-bar", "none"]);
export const RoleMarkerEnum = z.enum(["pill-filled", "pill-outlined", "band"]);
export const MotifEnum = z.enum(["none", "disc", "rings", "stripes", "chevron", "contour", "dots-plus"]);
export const MotifScaleEnum = z.enum(["small", "medium", "large"]);
export const MotifAnchorEnum = z.enum([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "top",
  "bottom",
  "left",
  "right",
]);
export const MotifColourEnum = z.enum(["primary", "secondary", "accent"]);
export const HeaderEnum = z.enum(["clean", "minimal", "solid"]);

export const DesignSpec = z.object({
  grid: GridEnum,
  photoShape: PhotoShapeEnum,
  photoSize: PhotoSizeEnum,
  accent: AccentEnum,
  roleMarker: RoleMarkerEnum,
  motif: MotifEnum,
  motifScale: MotifScaleEnum,
  motifAnchor: MotifAnchorEnum,
  motifColour: MotifColourEnum,
  header: HeaderEnum,
  mode: z.enum(["light", "dark", "colour-field"]).optional(),
  typography: z.enum(["space-grotesk", "source-serif"]).optional(),
  strategy: z.string().optional(),
});

/** @typedef {z.infer<typeof DesignSpec>} DesignSpecType */

// ═══════════════════════════════════════════════════════════════════════
//  2. Incompatible Combinations Table
// ═══════════════════════════════════════════════════════════════════════

/**
 * Checks whether a sampled DesignSpec violates compatibility constraints.
 *
 * @param {DesignSpecType} spec
 * @returns {boolean} True if compatible, false if incompatible.
 */
export function isCompatible(spec) {
  // 1. name-first has small photo; cannot be L
  if (spec.grid === "name-first" && spec.photoSize === "L") {
    return false;
  }
  // 2. photo-large requires prominent photo; cannot be S
  if (spec.grid === "photo-large" && spec.photoSize === "S") {
    return false;
  }
  // 3. stack-left-art-right has stack on the left; art and accent must not crowd the left edge
  if (spec.grid === "stack-left-art-right") {
    if (spec.accent === "edge-bar-left") return false;
    if (spec.motifAnchor === "left" || spec.motifAnchor === "top-left" || spec.motifAnchor === "bottom-left") {
      return false;
    }
  }
  // 4. stack-left-art-bottom has art at the bottom; anchor must not be top
  if (spec.grid === "stack-left-art-bottom") {
    if (spec.motifAnchor === "top" || spec.motifAnchor === "top-left" || spec.motifAnchor === "top-right") {
      return false;
    }
    if (spec.accent === "bottom-bar") {
      return false;
    }
  }
  // 5. stack-centre-art-corners has art only in corners
  if (spec.grid === "stack-centre-art-corners") {
    const isCorner = ["top-left", "top-right", "bottom-left", "bottom-right"].includes(spec.motifAnchor);
    if (!isCorner && spec.motif !== "none") return false;
    if (spec.accent === "corner-block") return false;
  }
  // 6. Accent and motif anchor collision on the same edge
  if (spec.accent === "edge-bar-right" && (spec.motifAnchor === "right" || spec.motifAnchor === "top-right" || spec.motifAnchor === "bottom-right")) {
    return false;
  }
  if (spec.accent === "edge-bar-left" && (spec.motifAnchor === "left" || spec.motifAnchor === "top-left" || spec.motifAnchor === "bottom-left")) {
    return false;
  }
  // 7. Role marker band colliding with bottom-bar accent
  if (spec.roleMarker === "band" && spec.accent === "bottom-bar") {
    return false;
  }
  // 8. name-first and photo-large have art on the right
  if (spec.grid === "name-first" || spec.grid === "photo-large") {
    if (spec.accent === "edge-bar-left") return false;
    if (spec.motifAnchor === "left" || spec.motifAnchor === "top-left" || spec.motifAnchor === "bottom-left") {
      return false;
    }
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════
//  3. Sampling
// ═══════════════════════════════════════════════════════════════════════

/**
 * Samples a random valid DesignSpec using the provided PRNG.
 *
 * @param {any} prng - Deterministic PRNG
 * @param {Record<string, any>} [_event] - Event spec (optional)
 * @param {any} [_hints] - Optional AI style hints (unused for now)
 * @returns {DesignSpecType}
 */
export function sampleSpec(prng, event = null, hints = null) {
  void event;
  void hints;
  const grids = GridEnum.options;
  const photoShapes = PhotoShapeEnum.options;
  const photoSizes = PhotoSizeEnum.options;
  const accents = AccentEnum.options;
  const roleMarkers = RoleMarkerEnum.options;
  const motifs = MotifEnum.options;
  const motifScales = MotifScaleEnum.options;
  const motifAnchors = MotifAnchorEnum.options;
  const motifColours = MotifColourEnum.options;
  const headers = HeaderEnum.options;
  const modes = ["light", "dark", "colour-field"];
  const typographies = ["space-grotesk", "source-serif"];

  for (let attempt = 0; attempt < 150; attempt++) {
    const rawSpec = {
      grid: prng.choice(grids),
      photoShape: prng.choice(photoShapes),
      photoSize: prng.choice(photoSizes),
      accent: prng.choice(accents),
      roleMarker: prng.choice(roleMarkers),
      motif: prng.choice(motifs),
      motifScale: prng.choice(motifScales),
      motifAnchor: prng.choice(motifAnchors),
      motifColour: prng.choice(motifColours),
      header: prng.choice(headers),
      mode: prng.choice(modes),
      typography: prng.choice(typographies),
      strategy: "event-led",
    };

    if (isCompatible(rawSpec)) {
      return DesignSpec.parse(rawSpec);
    }
  }

  // Safe fallback
  return DesignSpec.parse({
    grid: "stack-left-art-right",
    photoShape: "rounded",
    photoSize: "M",
    accent: "none",
    roleMarker: "pill-filled",
    motif: "disc",
    motifScale: "medium",
    motifAnchor: "top-right",
    motifColour: "accent",
    header: "minimal",
    mode: "light",
    typography: "space-grotesk",
    strategy: "event-led",
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  4. Motif Layer Generators
// ═══════════════════════════════════════════════════════════════════════

/**
 * Resolves motif fill color from palette.
 *
 * @param {string} motifColour - "primary" | "secondary" | "accent"
 * @param {string[]} palette
 * @param {string} [accentHex]
 * @returns {string} Hex color
 */
function resolveMotifColor(motifColour, palette, accentHex) {
  if (motifColour === "primary") return palette[0] || "#0F172A";
  if (motifColour === "secondary") return palette[1] || palette[0] || "#38BDF8";
  return accentHex || palette[1] || palette[0] || "#38BDF8";
}

/**
 * Pure generator for filled path motifs (Task E1 item 3).
 * Motifs are large and bold (30 to 70% of card), filled paths with NO stroke.
 * All line/wave ribbons have width >= 0.35 mm.
 * Motifs overflow trim by at least bleedMm (default 3 mm).
 *
 * @param {string} motif - Motif name
 * @param {any} prng
 * @param {{ x: number, y: number, w: number, h: number }} zoneBox
 * @param {"small" | "medium" | "large"} scale
 * @param {string} anchor
 * @param {string} fill
 * @param {number} [bleedMm]
 * @returns {{ d: string, box: { x: number, y: number, w: number, h: number } } | null}
 */
export function generateMotifPath(motif, prng, zoneBox, scale, anchor, fill, bleedMm = 3) {
  if (motif === "none") return null;

  const bMm = Math.min(Math.max(bleedMm, 3), 10);
  const scaleMult = scale === "small" ? 0.8 : scale === "large" ? 1.25 : 1.0;

  // Determine anchor coordinates.
  // Shapes must stay strictly inside zoneBox on inner bounds (x >= zoneBox.x, y >= zoneBox.y)
  // and may bleed outward beyond card trim edges (x >= 54, x <= 0, y >= 85.6).
  let ax = zoneBox.x + zoneBox.w / 2;
  let ay = zoneBox.y + zoneBox.h / 2;

  if (anchor === "top-right") {
    ax = 54;
    ay = zoneBox.y;
  } else if (anchor === "top-left") {
    ax = 0;
    ay = zoneBox.y;
  } else if (anchor === "bottom-right") {
    ax = 54;
    ay = 85.6;
  } else if (anchor === "bottom-left") {
    ax = 0;
    ay = 85.6;
  } else if (anchor === "right") {
    ax = 54;
    ay = zoneBox.y + zoneBox.h / 2;
  } else if (anchor === "left") {
    ax = 0;
    ay = zoneBox.y + zoneBox.h / 2;
  } else if (anchor === "top") {
    ax = zoneBox.x + zoneBox.w / 2;
    ay = zoneBox.y;
  } else if (anchor === "bottom") {
    ax = zoneBox.x + zoneBox.w / 2;
    ay = 85.6;
  }

  let d = "";
  let box = { x: zoneBox.x, y: zoneBox.y, w: zoneBox.w, h: zoneBox.h };

  if (motif === "disc") {
    // 1. Disc: a big disc, ring or half-disc larger than the card, bleeding off an edge
    // Radius is constrained so the circle never crosses inward past zoneBox.x or upward past zoneBox.y
    const maxR = Math.max(zoneBox.w, 8);
    const r = Math.min(maxR * 0.95, 20 * scaleMult);
    const isRing = prng.bool(0.4);

    // Adjust ay so top of circle does not go above zoneBox.y if anchored at top
    let cy = ay;
    if (anchor === "top-right" || anchor === "top-left" || anchor === "top") {
      cy = zoneBox.y + r;
    } else if (anchor === "bottom-right" || anchor === "bottom-left" || anchor === "bottom") {
      cy = 85.6;
    }

    let cx = ax;
    if (anchor === "top-left" || anchor === "bottom-left" || anchor === "left") {
      cx = 0;
    } else if (anchor === "top-right" || anchor === "bottom-right" || anchor === "right") {
      cx = 54;
    }

    if (isRing) {
      const thickness = Math.max(1.5 * scaleMult, 0.4);
      const rInner = Math.max(r - thickness, 0.5);
      d = `M ${(cx - r).toFixed(2)} ${cy.toFixed(2)} ` +
        `A ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(cx + r).toFixed(2)} ${cy.toFixed(2)} ` +
        `A ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(cx - r).toFixed(2)} ${cy.toFixed(2)} Z ` +
        `M ${(cx - rInner).toFixed(2)} ${cy.toFixed(2)} ` +
        `A ${rInner.toFixed(2)} ${rInner.toFixed(2)} 0 1 1 ${(cx + rInner).toFixed(2)} ${cy.toFixed(2)} ` +
        `A ${rInner.toFixed(2)} ${rInner.toFixed(2)} 0 1 1 ${(cx - rInner).toFixed(2)} ${cy.toFixed(2)} Z`;
    } else {
      d = `M ${(cx - r).toFixed(2)} ${cy.toFixed(2)} ` +
        `A ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(cx + r).toFixed(2)} ${cy.toFixed(2)} ` +
        `A ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(cx - r).toFixed(2)} ${cy.toFixed(2)} Z`;
    }
    box = {
      x: Math.max(zoneBox.x, cx - r),
      y: Math.max(zoneBox.y, cy - r),
      w: Math.min(zoneBox.w, r * 2),
      h: Math.min(zoneBox.h, r * 2),
    };
  } else if (motif === "rings") {
    // 2. Rings: 2 to 4 concentric ribbons
    const count = prng.int(2, 4);
    const maxR = Math.min(zoneBox.w * 0.95, 22 * scaleMult);
    const baseR = Math.max(maxR * 0.4, 4);
    const ringSpacing = (maxR - baseR) / Math.max(count - 1, 1);
    const thickness = Math.max(1.0 * scaleMult, 0.4);
    const paths = [];

    let cy = ay;
    if (anchor === "top-right" || anchor === "top-left" || anchor === "top") {
      cy = zoneBox.y + maxR;
    } else if (anchor === "bottom-right" || anchor === "bottom-left" || anchor === "bottom") {
      cy = 85.6;
    }

    let cx = ax;
    if (anchor === "top-left" || anchor === "bottom-left" || anchor === "left") {
      cx = 0;
    } else if (anchor === "top-right" || anchor === "bottom-right" || anchor === "right") {
      cx = 54;
    }

    for (let i = 0; i < count; i++) {
      const rOut = baseR + i * ringSpacing;
      const rIn = Math.max(rOut - thickness, 0.5);
      paths.push(
        `M ${(cx - rOut).toFixed(2)} ${cy.toFixed(2)} ` +
        `A ${rOut.toFixed(2)} ${rOut.toFixed(2)} 0 1 0 ${(cx + rOut).toFixed(2)} ${cy.toFixed(2)} ` +
        `A ${rOut.toFixed(2)} ${rOut.toFixed(2)} 0 1 0 ${(cx - rOut).toFixed(2)} ${cy.toFixed(2)} Z ` +
        `M ${(cx - rIn).toFixed(2)} ${cy.toFixed(2)} ` +
        `A ${rIn.toFixed(2)} ${rIn.toFixed(2)} 0 1 1 ${(cx + rIn).toFixed(2)} ${cy.toFixed(2)} ` +
        `A ${rIn.toFixed(2)} ${rIn.toFixed(2)} 0 1 1 ${(cx - rIn).toFixed(2)} ${cy.toFixed(2)} Z`
      );
    }
    d = paths.join(" ");
    box = {
      x: Math.max(zoneBox.x, cx - maxR),
      y: Math.max(zoneBox.y, cy - maxR),
      w: Math.min(zoneBox.w, maxR * 2),
      h: Math.min(zoneBox.h, maxR * 2),
    };
  } else if (motif === "stripes") {
    // 3. Stripes: diagonal band set of 3 to 5 parallel ribbons
    const count = prng.int(3, 5);
    const ribbonW = Math.max(1.5 * scaleMult, 0.4);
    const step = ribbonW + 2.4 * scaleMult;
    const len = 40;
    const paths = [];

    const startX = zoneBox.x + 1;
    const startY = zoneBox.y + 1;

    for (let i = 0; i < count; i++) {
      const x0 = startX + i * step;
      const y0 = startY;
      const p1 = `${x0.toFixed(2)},${y0.toFixed(2)}`;
      const p2 = `${(x0 + ribbonW).toFixed(2)},${y0.toFixed(2)}`;
      const p3 = `${(x0 + ribbonW + len * 0.7).toFixed(2)},${(y0 + len * 0.7).toFixed(2)}`;
      const p4 = `${(x0 + len * 0.7).toFixed(2)},${(y0 + len * 0.7).toFixed(2)}`;
      paths.push(`M ${p1} L ${p2} L ${p3} L ${p4} Z`);
    }
    d = paths.join(" ");
    box = {
      x: startX,
      y: startY,
      w: Math.min(zoneBox.w, count * step + len * 0.7),
      h: Math.min(zoneBox.h, len * 0.7),
    };
  } else if (motif === "chevron") {
    // 4. Chevron: one or two angular wedges
    const count = prng.int(1, 2);
    const thickness = Math.max(2.0 * scaleMult, 0.5);
    const wedgeW = Math.min(zoneBox.w * 0.9, 24 * scaleMult);
    const wedgeH = Math.min(zoneBox.h * 0.3, 14 * scaleMult);
    const paths = [];

    const cx = zoneBox.x + zoneBox.w / 2;
    const startY = zoneBox.y + wedgeH / 2 + 2;

    for (let i = 0; i < count; i++) {
      const cy = startY + i * (wedgeH + 3.0);
      const topApexX = cx;
      const topApexY = cy - wedgeH / 2;
      const leftX = cx - wedgeW / 2;
      const leftY = cy + wedgeH / 2;
      const rightX = cx + wedgeW / 2;
      const rightY = cy + wedgeH / 2;

      paths.push(
        `M ${leftX.toFixed(2)} ${leftY.toFixed(2)} ` +
        `L ${topApexX.toFixed(2)} ${topApexY.toFixed(2)} ` +
        `L ${rightX.toFixed(2)} ${rightY.toFixed(2)} ` +
        `L ${(rightX - thickness).toFixed(2)} ${(rightY + thickness).toFixed(2)} ` +
        `L ${topApexX.toFixed(2)} ${(topApexY + thickness).toFixed(2)} ` +
        `L ${(leftX + thickness).toFixed(2)} ${(leftY + thickness).toFixed(2)} Z`
      );
    }
    d = paths.join(" ");
    box = {
      x: cx - wedgeW / 2,
      y: startY - wedgeH / 2,
      w: wedgeW,
      h: count * (wedgeH + 3.0),
    };
  } else if (motif === "contour") {
    // 5. Contour: 3 to 6 wave ribbons following sine curves
    const count = prng.int(3, 5);
    const ribbonThick = Math.max(0.6 * scaleMult, 0.35);
    const spacing = Math.min((zoneBox.h - 10) / count, 4.0 * scaleMult);
    const width = zoneBox.w + bMm;
    const x0 = zoneBox.x;
    const paths = [];

    const startY = zoneBox.y + 6;

    for (let c = 0; c < count; c++) {
      const baseY = startY + c * spacing;
      const ptsTop = [];
      const ptsBot = [];
      const steps = 14;
      for (let s = 0; s <= steps; s++) {
        const px = x0 + (s / steps) * width;
        const py = baseY + Math.sin((s / steps) * Math.PI * 2) * 2.5;
        ptsTop.push(`${px.toFixed(2)} ${py.toFixed(2)}`);
        ptsBot.unshift(`${px.toFixed(2)} ${(py + ribbonThick).toFixed(2)}`);
      }
      paths.push(`M ${ptsTop[0]} L ${ptsTop.slice(1).join(" L ")} L ${ptsBot.join(" L ")} Z`);
    }
    d = paths.join(" ");
    box = {
      x: x0,
      y: startY - 3,
      w: zoneBox.w,
      h: count * spacing + 6,
    };
  } else if (motif === "dots-plus") {
    // 6. Dots-plus: grid of dots and plus marks
    const cols = Math.max(2, Math.floor(zoneBox.w / 6));
    const rows = Math.max(3, Math.floor(zoneBox.h / 12));
    const step = Math.min(5.5 * scaleMult, (zoneBox.w - 3) / Math.max(cols - 1, 1));
    const x0 = zoneBox.x + 1.5;
    const y0 = zoneBox.y + 2;
    const dotR = Math.max(0.7 * scaleMult, 0.35);
    const plusArm = Math.max(1.2 * scaleMult, 0.6);
    const plusThick = Math.max(0.5 * scaleMult, 0.35);
    const paths = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = x0 + c * step;
        const py = y0 + r * step;
        if ((r + c) % 2 === 0) {
          paths.push(
            `M ${(px - dotR).toFixed(2)} ${py.toFixed(2)} ` +
            `A ${dotR.toFixed(2)} ${dotR.toFixed(2)} 0 1 0 ${(px + dotR).toFixed(2)} ${py.toFixed(2)} ` +
            `A ${dotR.toFixed(2)} ${dotR.toFixed(2)} 0 1 0 ${(px - dotR).toFixed(2)} ${py.toFixed(2)} Z`
          );
        } else {
          paths.push(
            `M ${(px - plusThick / 2).toFixed(2)} ${(py - plusArm).toFixed(2)} ` +
            `H ${(px + plusThick / 2).toFixed(2)} ` +
            `V ${(py + plusArm).toFixed(2)} ` +
            `H ${(px - plusThick / 2).toFixed(2)} Z ` +
            `M ${(px - plusArm).toFixed(2)} ${(py - plusThick / 2).toFixed(2)} ` +
            `H ${(px + plusArm).toFixed(2)} ` +
            `V ${(py + plusThick / 2).toFixed(2)} ` +
            `H ${(px - plusArm).toFixed(2)} Z`
          );
        }
      }
    }
    d = paths.join(" ");
    box = {
      x: zoneBox.x,
      y: zoneBox.y,
      w: zoneBox.w,
      h: zoneBox.h,
    };
  }

  return { d, box };
}

// ═══════════════════════════════════════════════════════════════════════
//  5. Bounding-Box Overlap Check (Invariant assertion)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Checks if two axis-aligned bounding boxes overlap.
 *
 * @param {{ x: number, y: number, w: number, h: number }} b1
 * @param {{ x: number, y: number, w: number, h: number }} b2
 * @param {number} [tolerance]
 * @returns {boolean}
 */
export function boxesOverlap(b1, b2, tolerance = 0.5) {
  const noOverlap =
    b1.x + b1.w <= b2.x + tolerance ||
    b2.x + b2.w <= b1.x + tolerance ||
    b1.y + b1.h <= b2.y + tolerance ||
    b2.y + b2.h <= b1.y + tolerance;
  return !noOverlap;
}

// ═══════════════════════════════════════════════════════════════════════
//  6. Layout Solver & Spec Builder
// ═══════════════════════════════════════════════════════════════════════

/**
 * Pure engine builder: compiles a DesignSpec into { skeleton, blocks, theme, look, spec }.
 *
 * @param {DesignSpecType} spec
 * @param {Record<string, any>} event
 * @param {string[]} palette
 * @param {string} lookId
 * @param {number} [seed]
 * @returns {{
 *   skeleton: any,
 *   blocks: Record<string, any>,
 *   theme: any,
 *   look: any,
 *   archetype: string,
 *   spec: DesignSpecType,
 *   modeFallback?: boolean,
 * } | null}
 */
export function buildFromSpec(spec, event, palette, lookId, seed = 42) {
  if (event?.card?.heightMm && event.card.heightMm < 80) {
    return null;
  }
  const prng = {
    seed: seed || 42,
    bool: (p = 0.5) => ((seed * 9301 + 49297) % 233280) / 233280 < p,
    int: (min, max) => min + Math.floor((((seed * 9301 + 49297) % 233280) / 233280) * (max - min + 1)),
  };

  const { mode, fallback } = sampleModeForPalette(prng, palette, spec.mode);
  const theme = deriveTheme(palette, mode, "event-led", `theme.${lookId}`);
  const typePairKey = spec.typography || "space-grotesk";
  const typePair = FONT_PAIRINGS[typePairKey] || FONT_PAIRINGS["space-grotesk"];
  theme.fonts = { heading: typePair.heading, body: typePair.body };

  const skeletonId = `skel.${lookId}`;
  const headerStyle = spec.header;

  // Card bounds: 54 x 85.6 mm
  const cardW = 54;
  const cardH = 85.6;
  const headerH = 20;
  const safeMargin = 3;

  // Body zone: strictly below header down to bottom margin
  const bodyTop = headerH + 1; // 21 mm
  const bodyBottom = cardH - safeMargin; // 82.6 mm
  const bodyAvailableH = bodyBottom - bodyTop; // 61.6 mm

  // Content zone & Motif zone according to grid
  /** @type {{ x: number, y: number, w: number, h: number }} */
  let contentZone;
  /** @type {{ x: number, y: number, w: number, h: number }} */
  let motifZone;

  if (spec.grid === "stack-left-art-right") {
    // Left 60% is content, right 40% is motif zone
    contentZone = { x: 3, y: bodyTop, w: 28, h: bodyAvailableH };
    motifZone = { x: 33, y: bodyTop, w: 21, h: bodyAvailableH };
  } else if (spec.grid === "stack-left-art-bottom") {
    // Upper body is content, bottom area is motif zone
    contentZone = { x: 3, y: bodyTop, w: 48, h: 35 };
    motifZone = { x: 0, y: bodyTop + 37, w: 54, h: bodyAvailableH - 37 };
  } else if (spec.grid === "stack-centre-art-corners") {
    // Center is content, designated corner is motif zone
    contentZone = { x: 9.5, y: bodyTop, w: 35, h: bodyAvailableH };
    if (spec.motifAnchor === "top-left") {
      motifZone = { x: 0, y: bodyTop, w: 8.5, h: 20 };
    } else if (spec.motifAnchor === "bottom-left") {
      motifZone = { x: 0, y: bodyBottom - 20, w: 8.5, h: 20 };
    } else if (spec.motifAnchor === "bottom-right") {
      motifZone = { x: 45.5, y: bodyBottom - 20, w: 8.5, h: 20 };
    } else {
      // top-right or fallback
      motifZone = { x: 45.5, y: bodyTop, w: 8.5, h: 20 };
    }
  } else if (spec.grid === "name-first") {
    // Big name on top, compact photo, right art
    contentZone = { x: 3, y: bodyTop, w: 28, h: bodyAvailableH };
    motifZone = { x: 33, y: bodyTop, w: 21, h: bodyAvailableH };
  } else {
    // photo-large: prominent photo on left, right art
    contentZone = { x: 3, y: bodyTop, w: 28, h: bodyAvailableH };
    motifZone = { x: 33, y: bodyTop, w: 21, h: bodyAvailableH };
  }

  // 1. Stack Solver (Invariants: gaps >= 2mm, name largest text, role >= 7pt)
  let photoW;
  let photoH;
  if (spec.grid === "photo-large") {
    photoW = spec.photoSize === "L" ? 28 : 25;
    photoH = photoW;
  } else if (spec.grid === "name-first") {
    photoW = spec.photoSize === "S" ? 18 : 20;
    photoH = photoW;
  } else if (spec.grid === "stack-left-art-bottom") {
    photoW = spec.photoSize === "L" ? 18 : spec.photoSize === "S" ? 14 : 16;
    photoH = photoW;
  } else {
    photoW = spec.photoSize === "S" ? 18 : spec.photoSize === "L" ? 24 : 22;
    photoH = photoW;
  }

  // Name size range: approved 20 pt maximum for 2 lines on stack-left-art-right and name-first
  const isName20 = spec.grid === "stack-left-art-right" || spec.grid === "name-first";
  const nameSizeRange = isName20 ? [20, 9] : [16, 9];
  const nameH = isName20 ? 10.5 : (spec.grid === "stack-left-art-bottom" ? 8.0 : 9.0);

  // Role marker height
  const roleMarkerH = spec.roleMarker === "band" ? 5.8 : (spec.grid === "stack-left-art-bottom" ? 4.8 : 5.8);

  // Collect text bounding boxes for motif collision detection
  const textBoundingBoxes = [];

  // Event name box (in header: y in [13.6, 19.2], x in [3.24, 50.76])
  textBoundingBoxes.push({ x: 3.24, y: 13.6, w: 47.52, h: 5.6 });

  let photoBox;
  let nameBox;
  let roleBox;
  let orgBox = null;
  let idBox = null;

  const gap = spec.grid === "stack-left-art-bottom" ? 2.0 : 2.5; // >= 2mm invariant
  const maxContentY = spec.grid === "stack-left-art-bottom" ? motifZone.y - 1.0 : bodyBottom;
  let currentY = contentZone.y;

  if (spec.grid === "name-first") {
    // Name first
    nameBox = { x: contentZone.x, y: currentY, w: contentZone.w, h: nameH };
    textBoundingBoxes.push(nameBox);
    currentY += nameH + gap;

    // Role marker
    roleBox = { x: contentZone.x, y: currentY, w: Math.min(contentZone.w, 28), h: roleMarkerH };
    textBoundingBoxes.push(roleBox);
    currentY += roleMarkerH + gap;

    // Photo
    photoBox = { x: contentZone.x, y: currentY, w: photoW, h: photoH };
    currentY += photoH + gap;

    // Optional org
    if (currentY + 4.5 <= maxContentY) {
      orgBox = { x: contentZone.x, y: currentY, w: contentZone.w, h: 4.5 };
      textBoundingBoxes.push(orgBox);
    }
  } else {
    // Photo first
    const photoX = spec.grid === "stack-centre-art-corners"
      ? contentZone.x + (contentZone.w - photoW) / 2
      : contentZone.x;
    photoBox = { x: photoX, y: currentY, w: photoW, h: photoH };
    currentY += photoH + gap;

    // Name
    nameBox = { x: contentZone.x, y: currentY, w: contentZone.w, h: nameH };
    textBoundingBoxes.push(nameBox);
    currentY += nameH + gap;

    // Role
    const roleW = spec.roleMarker === "band" ? contentZone.w : Math.min(contentZone.w, 28);
    const roleX = spec.grid === "stack-centre-art-corners"
      ? contentZone.x + (contentZone.w - roleW) / 2
      : contentZone.x;
    roleBox = { x: roleX, y: currentY, w: roleW, h: roleMarkerH };
    textBoundingBoxes.push(roleBox);
    currentY += roleMarkerH + gap;

    // Optional org & id if space permits
    if (currentY + 4.0 <= maxContentY) {
      orgBox = { x: contentZone.x, y: currentY, w: contentZone.w, h: 4.0 };
      textBoundingBoxes.push(orgBox);
      currentY += 4.0 + gap;
    }
    if (currentY + 3.5 <= maxContentY) {
      idBox = { x: contentZone.x, y: currentY, w: contentZone.w, h: 3.5 };
      textBoundingBoxes.push(idBox);
    }
  }

  // 2. Generate Motif Path
  const motifColor = resolveMotifColor(spec.motifColour, palette, theme.colors.accent);
  const motifData = generateMotifPath(
    spec.motif,
    prng,
    motifZone,
    spec.motifScale,
    spec.motifAnchor,
    motifColor,
    3
  );

  // 3. Invariant Assertion: Motifs NEVER overlap any text box
  if (motifData && motifData.d) {
    for (const tBox of textBoundingBoxes) {
      if (boxesOverlap(motifData.box, tBox, 0.2)) {
        // Drop spec if motif collides with text
        return null;
      }
    }
  }

  // 4. Accent Decor Element
  /** @type {any[]} */
  const accentElements = [];
  if (spec.accent === "edge-bar-left") {
    accentElements.push({
      id: "accent-bar",
      type: "rect",
      box: [0, 0, 100, 100],
      fill: "$theme.colors.accent",
      decor: true,
    });
  } else if (spec.accent === "edge-bar-right") {
    accentElements.push({
      id: "accent-bar",
      type: "rect",
      box: [0, 0, 100, 100],
      fill: "$theme.colors.accent",
      decor: true,
    });
  } else if (spec.accent === "bottom-bar") {
    accentElements.push({
      id: "accent-bar",
      type: "rect",
      box: [0, 0, 100, 100],
      fill: "$theme.colors.accent",
      decor: true,
    });
  } else if (spec.accent === "corner-block") {
    accentElements.push({
      id: "accent-corner",
      type: "rect",
      box: [0, 0, 100, 100],
      fill: "$theme.colors.accent",
      decor: true,
    });
  }

  // 5. Build Skeletons and Blocks
  const slots = {
    header: [0, 0, 54, 20],
    content: [contentZone.x, contentZone.y, contentZone.w, contentZone.h],
    art: [motifZone.x, motifZone.y, motifZone.w, motifZone.h],
  };

  if (spec.accent === "edge-bar-left") {
    slots.accent = [0, 0, 3, 85.6];
  } else if (spec.accent === "edge-bar-right") {
    slots.accent = [51, 0, 3, 85.6];
  } else if (spec.accent === "bottom-bar") {
    slots.accent = [0, 81.6, 54, 4];
  } else if (spec.accent === "corner-block") {
    slots.accent = [44, 75.6, 10, 10];
  }

  const skeleton = {
    id: skeletonId,
    size: { w: cardW, h: cardH },
    slots,
  };

  // Convert mm coords within contentZone into percent [x%, y%, w%, h%]
  const toContentPct = (b) => [
    Math.round(((b.x - contentZone.x) / contentZone.w) * 10000) / 100,
    Math.round(((b.y - contentZone.y) / contentZone.h) * 10000) / 100,
    Math.round((b.w / contentZone.w) * 10000) / 100,
    Math.round((b.h / contentZone.h) * 10000) / 100,
  ];

  // Role marker styling
  const align = spec.grid === "stack-centre-art-corners" ? "center" : "left";
  const roleTextFill = spec.roleMarker === "pill-filled" || spec.roleMarker === "band"
    ? "$role.contrast"
    : "$theme.colors.text";

  const contentElements = [
    {
      id: "photo",
      type: "image",
      box: toContentPct(photoBox),
      src: "$person.photo",
      clip: spec.photoShape,
    },
    {
      id: "name",
      type: "text",
      bind: "person.name",
      font: "heading",
      box: toContentPct(nameBox),
      size: nameSizeRange,
      oneLineFloor: 9,
      maxLines: 2,
      align,
    },
  ];

  // Role marker rect (decor: true so validator does not flag overlap with role text)
  if (spec.roleMarker === "pill-filled") {
    contentElements.push({
      id: "role-pill",
      type: "rect",
      box: toContentPct(roleBox),
      fill: "$role.color",
      radius: 3,
      decor: true,
    });
  } else if (spec.roleMarker === "pill-outlined") {
    contentElements.push({
      id: "role-pill",
      type: "rect",
      box: toContentPct(roleBox),
      fill: "none",
      stroke: "$role.color",
      strokeWidth: 0.6,
      radius: 3,
      decor: true,
    });
  } else if (spec.roleMarker === "band") {
    contentElements.push({
      id: "role-band",
      type: "rect",
      box: toContentPct(roleBox),
      fill: "$role.color",
      decor: true,
    });
  }

  // Role label text (always 7 pt or more bold capitals, centered with padding)
  contentElements.push({
    id: "role",
    type: "text",
    bind: "role.label",
    font: "heading",
    box: toContentPct(roleBox),
    size: [7.5, 7],
    maxLines: 1,
    align: "center",
    fill: roleTextFill,
  });

  if (orgBox) {
    contentElements.push({
      id: "org",
      type: "text",
      bind: "person.org",
      font: "body",
      box: toContentPct(orgBox),
      size: [7, 5.5],
      maxLines: 1,
      align,
      fill: "$theme.colors.text",
      optional: true,
    });
  }

  if (idBox) {
    contentElements.push({
      id: "id-line",
      type: "text",
      bind: "person.id",
      font: "body",
      box: toContentPct(idBox),
      size: [6, 5.5],
      maxLines: 1,
      align,
      fill: "$theme.colors.text",
      optional: true,
    });
  }

  // Art elements (motif path)
  /** @type {any[]} */
  const artElements = [];
  if (motifData && motifData.d) {
    artElements.push({
      id: `motif-${spec.motif}`,
      type: "path",
      box: [0, 0, 100, 100],
      d: motifData.d,
      fill: motifColor,
      decor: true,
    });
  }

  const blocks = {
    [`header.${lookId}`]: {
      id: `header.${lookId}`,
      slot: "header",
      elements: headerStyle === "minimal"
        ? [
            { id: "logo1", type: "image", box: [6, 16, 24, 45], src: "$brand.logo.primary", plate: "auto" },
            { id: "logo2", type: "image", box: [32, 16, 24, 45], src: "$brand.logo.secondary", plate: "auto" },
            {
              id: "event-name",
              type: "text",
              bind: "event.name",
              font: "heading",
              box: [6, 68, 88, 28],
              size: [8.5, 5.5],
              maxLines: 2,
              align: "left",
              fill: "$theme.colors.text",
              optional: true,
            },
          ]
        : headerStyle === "solid"
        ? [
            { id: "band", type: "rect", box: [0, 0, 100, 100], fill: "$theme.colors.accent", decor: true },
            { id: "logo1", type: "image", box: [6, 16, 24, 45], src: "$brand.logo.primary", plate: "auto" },
            { id: "logo2", type: "image", box: [70, 16, 24, 45], src: "$brand.logo.secondary", plate: "auto" },
            {
              id: "event-name",
              type: "text",
              bind: "event.name",
              font: "heading",
              box: [6, 68, 88, 28],
              size: [8.5, 5.5],
              maxLines: 2,
              align: "center",
              fill: "#FFFFFF",
              optional: true,
            },
          ]
        : [
            // clean header
            { id: "logo1", type: "image", box: [6, 16, 24, 45], src: "$brand.logo.primary", plate: "auto" },
            { id: "logo2", type: "image", box: [70, 16, 24, 45], src: "$brand.logo.secondary", plate: "auto" },
            {
              id: "event-name",
              type: "text",
              bind: "event.name",
              font: "heading",
              box: [6, 68, 88, 28],
              size: [8.5, 5.5],
              maxLines: 2,
              align: "center",
              fill: "$theme.colors.text",
              optional: true,
            },
          ],
    },
    [`content.${lookId}`]: {
      id: `content.${lookId}`,
      slot: "content",
      elements: contentElements,
    },
    [`art.${lookId}`]: {
      id: `art.${lookId}`,
      slot: "art",
      elements: artElements,
    },
  };

  if (slots.accent) {
    blocks[`accent.${lookId}`] = {
      id: `accent.${lookId}`,
      slot: "accent",
      elements: accentElements,
    };
  }

  const archetypeStr = `${spec.grid}.${spec.motif}.${spec.accent}`;

  const look = {
    id: lookId,
    skeleton: skeletonId,
    theme: theme.id,
    blocks: {
      header: `header.${lookId}`,
      content: `content.${lookId}`,
      art: `art.${lookId}`,
      ...(slots.accent ? { accent: `accent.${lookId}` } : {}),
    },
    attributes: {
      skeleton: spec.grid,
      header: spec.header,
      photo: `${spec.photoShape}-${spec.photoSize}`,
      marker: spec.roleMarker,
      theme: theme.id,
      mode,
      strategy: "event-led",
      typography: typePairKey,
      archetype: archetypeStr,
      modeFallback: fallback,
    },
    tags: ["modern", "badge", spec.grid, mode],
    requires: {
      orientation: ["portrait"],
      maxRoles: 6,
      needsPhotoSlot: true,
    },
  };

  return {
    skeleton,
    blocks,
    theme,
    look,
    archetype: archetypeStr,
    spec,
    modeFallback: fallback,
  };
}
