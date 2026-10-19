// @ts-check
import { renderCard } from "./render.js";
import { distance, MIN_PAIR_DISTANCE } from "./picker.js";
import { stressSet } from "./stressSet.js";
import { contrastRatio, relativeLuminance } from "./validate.js";
import { deriveTheme, hexToRgb, rgbToHsl } from "./themeDerivation.js";

/**
 * @module core/composer
 * Pure parameter-driven layout composer and quality scorer (Spike C1 + C2 + C2b).
 * Core remains 100% pure: no Math.random, no Date.now, no file/network I/O (D-06).
 */

/**
 * Available portrait layout archetypes.
 */
export const ARCHETYPES = /** @type {const} */ ([
  "hero-photo-top",
  "colour-block-split",
  "circle-badge-centre",
  "typographic-name-first",
]);

/**
 * Default role colors with 4 distinct lightness steps (all >= 15% apart).
 * Applied only to default/unspecified role colors; user-specified colors are kept as given.
 *
 * Lightness values:
 * - volunteer:   #BAE6FD -> 86.1% L
 * - participant: #60A5FA -> 67.8% L (diff 18.3% >= 15%)
 * - organizer:   #D97706 -> 43.7% L (diff 24.1% >= 15%)
 * - mentor:      #1E293B -> 17.5% L (diff 26.2% >= 15%)
 */
export const DEFAULT_ROLE_COLORS = /** @type {const} */ ({
  volunteer: "#BAE6FD",
  participant: "#60A5FA",
  organizer: "#D97706",
  mentor: "#1E293B",
});

/**
 * Curated typography pairings using verified static TTF fonts.
 * - space-grotesk: Modern Grotesk (Space Grotesk Bold heading + Inter Regular body)
 * - source-serif: Editorial Serif (Source Serif 4 Bold heading + Source Sans 3 Regular body)
 */
export const FONT_PAIRINGS = /** @type {const} */ ({
  "space-grotesk": {
    id: "space-grotesk",
    name: "Modern Grotesk",
    heading: "Space Grotesk",
    body: "Inter",
    headingFile: "assets/fonts/SpaceGrotesk-Bold.ttf",
    bodyFile: "assets/fonts/Inter-Regular.ttf",
  },
  "source-serif": {
    id: "source-serif",
    name: "Editorial Serif",
    heading: "Source Serif 4",
    body: "Source Sans 3",
    headingFile: "assets/fonts/SourceSerif4-Bold.ttf",
    bodyFile: "assets/fonts/SourceSans3-Regular.ttf",
  },
});

/**
 * Resolves role color, respecting user-specified role colors when provided.
 *
 * @param {string} roleId
 * @param {Record<string, any>} [event]
 * @returns {string}
 */
export function getRoleColor(roleId, event) {
  const roleMatch = event?.roles?.find((r) => r.id === roleId);
  if (roleMatch?.color?.value && roleMatch?.color?.status !== "defaulted") {
    return roleMatch.color.value;
  }
  return DEFAULT_ROLE_COLORS[roleId] || DEFAULT_ROLE_COLORS.participant;
}

/**
 * Deterministic 32-bit hash of a string or number seed.
 *
 * @param {string | number} seed
 * @returns {number}
 */
export function hashSeed(seed) {
  if (typeof seed === "number") return seed | 0;
  const str = String(seed);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Lightweight, fast, deterministic PRNG (Mulberry32).
 *
 * @param {string | number} seed
 */
export function createPrng(seed) {
  let s = hashSeed(seed);
  return {
    /** Generates float in [0, 1) */
    next() {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** Generates integer in [min, max] inclusive */
    int(min, max) {
      return min + Math.floor(this.next() * (max - min + 1));
    },
    /** Generates float in [min, max] */
    float(min, max) {
      return min + this.next() * (max - min);
    },
    /** Picks one item from array */
    choice(arr) {
      return arr[this.int(0, arr.length - 1)];
    },
    /** Boolean with probability p */
    bool(p = 0.5) {
      return this.next() < p;
    },
  };
}

/**
 * Samples a theme mode independently of archetype, falling back if the palette cannot support it.
 *
 * @param {ReturnType<typeof createPrng>} prng
 * @param {string[]} palette
 * @param {string} [requestedMode]
 * @returns {{ mode: "light" | "dark" | "colour-field", fallback: boolean }}
 */
export function sampleModeForPalette(prng, palette, requestedMode) {
  const mode = requestedMode || prng.choice(["light", "dark", "colour-field"]);
  const p0 = palette[0] || "#0085FF";
  const [r0, g0, b0] = hexToRgb(p0);
  const [, , l0] = rgbToHsl(r0, g0, b0);

  if (mode === "colour-field") {
    // If palette color is extremely light (l0 > 0.90) or muddy
    const wCr = contrastRatio("#FFFFFF", p0);
    const bCr = contrastRatio("#111827", p0);
    if (wCr < 3.0 && bCr < 3.0) {
      return { mode: "light", fallback: true };
    }
    if (l0 > 0.92) {
      return { mode: "light", fallback: true };
    }
  } else if (mode === "dark") {
    // If palette has only one near-black color where accent is invisible on dark bg (#0F172A)
    const hasContrastAccent = palette.some((c) => contrastRatio(c, "#0F172A") >= 3.0);
    if (!hasContrastAccent && palette.length === 1) {
      return { mode: "light", fallback: true };
    }
  }

  return { mode, fallback: false };
}

/**
 * Checks if a color is neutral (white, near-black, or grey).
 * White, near-black, and greys must not count toward palette score (P0-1c Condition 1).
 *
 * @param {string} hex
 * @returns {boolean}
 */
export function isNeutral(hex) {
  if (!hex || typeof hex !== "string") return true;
  const clean = hex.startsWith("#") ? hex : `#${hex}`;
  if (clean.length !== 7) return true;
  const [r, g, b] = hexToRgb(clean);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;
  const [, s, l] = rgbToHsl(r, g, b);
  if (l >= 0.90) return true; // white / near-white
  if (max <= 42 && spread <= 25) return true; // near-black (e.g. #111827, #000000)
  if (spread <= 25 || s <= 0.12) return true; // greys
  return false;
}

/**
 * Measures layout quality across 4 objective, measurable dimensions (0-100 total score).
 *
 * Dimensions:
 * 1. Real Rendered Name-to-role text scale ratio (>= 2.0x gives full 25 pts; role must be >= 7 pt)
 * 2. Empty space share (22% to 42% target band gives full 25 pts; >45% penalised, >52% heavily penalised)
 * 3. Visible usage of event palette colours (>= 2 palette colours gives full 25 pts)
 * 4. Alignment axes count (left, centre, right edges; single centre axis gives full 25 pts)
 *
 * @param {any[]} scene - Rendered scene graph
 * @param {Record<string, any>} [context={}]
 * @returns {{
 *   total: number,
 *   nameToRoleRatio: number,
 *   whitespaceShare: number,
 *   alignmentAxes: number,
 *   paletteColorsUsed: number,
 *   breakdown: {
 *     ratioScore: number,
 *     whitespaceScore: number,
 *     paletteScore: number,
 *     alignmentScore: number,
 *   }
 * }}
 */
export function scoreQuality(scene, context = {}) {
  const cardW = context?.card?.widthMm || 54;
  const cardH = context?.card?.heightMm || 85.6;
  const totalArea = cardW * cardH;

  // 1. Real Rendered Name-to-Role scale ratio
  const nameNode = scene.find((n) => n.id === "name" || n.bind === "person.name");
  const roleNode = scene.find((n) => n.id === "role" || n.bind === "role.label");

  const nameSize = nameNode?.sizeMm || 0;
  const roleSize = roleNode?.sizeMm || 0;
  const ratio = roleSize > 0 ? nameSize / roleSize : 0;

  let ratioScore = 0;
  // Role text must be at least 7 pt (2.47 mm) — do not hit ratio by shrinking role
  if (roleSize >= 2.3) {
    if (ratio >= 2.0) ratioScore = 25;
    else if (ratio >= 1.8) ratioScore = 18;
    else if (ratio >= 1.6) ratioScore = 12;
    else if (ratio >= 1.4) ratioScore = 6;
    else ratioScore = 0;
  } else {
    ratioScore = 0;
  }

  // 2. Whitespace share (target 22% to 42%)
  let contentArea = 0;
  const contentNodes = scene.filter((n) => !n.decor && n.box && n.id !== "bg");
  for (const node of contentNodes) {
    contentArea += (node.box.w || 0) * (node.box.h || 0);
  }
  const emptySpaceShare = Math.max(0, 1 - contentArea / totalArea);

  let whitespaceScore = 0;
  if (emptySpaceShare >= 0.22 && emptySpaceShare <= 0.42) {
    whitespaceScore = 25;
  } else if (
    (emptySpaceShare >= 0.18 && emptySpaceShare < 0.22) ||
    (emptySpaceShare > 0.42 && emptySpaceShare <= 0.46)
  ) {
    whitespaceScore = 16;
  } else if (emptySpaceShare > 0.46 && emptySpaceShare <= 0.52) {
    whitespaceScore = 6;
  } else if (emptySpaceShare > 0.52) {
    whitespaceScore = 0; // Penalise empty space above ~45-50%
  } else {
    whitespaceScore = 2; // Under 18% is too cramped
  }

  // 3. Visible Usage of Event Palette Colours (P0-1c Condition 1)
  // Count ONLY colours derived from event palette (accent/primary fills, and background on dark and colour-field cards).
  // White, near-black, and greys must not count.
  const rawPalette =
    context?.palette ||
    context?.event?.event?.palette ||
    context?.event?.palette ||
    [];
  const palette = Array.isArray(rawPalette) ? rawPalette.map((c) => String(c).toUpperCase()) : [];

  const eligiblePaletteTones = new Set();
  for (const c of palette) {
    if (!isNeutral(c)) eligiblePaletteTones.add(c);
  }

  if (context?.theme?.colors?.accent) {
    const acc = String(context.theme.colors.accent).toUpperCase();
    if (!isNeutral(acc)) eligiblePaletteTones.add(acc);
  }

  const mode = context?.mode || context?.theme?.mode || context?.look?.attributes?.mode;
  const isDarkOrColourField = mode === "dark" || mode === "colour-field";
  if (isDarkOrColourField && context?.theme?.colors?.background) {
    const bg = String(context.theme.colors.background).toUpperCase();
    if (!isNeutral(bg)) eligiblePaletteTones.add(bg);
  }

  let paletteColorsUsed = 0;
  if (eligiblePaletteTones.size > 0) {
    const seenFills = new Set();
    for (const node of scene) {
      if (!node.fill || typeof node.fill !== "string") continue;
      const fill = node.fill.toUpperCase();
      if (isNeutral(fill)) continue;
      if (node.id === "bg" && !isDarkOrColourField) continue;
      if (eligiblePaletteTones.has(fill) && !seenFills.has(fill)) {
        seenFills.add(fill);
        paletteColorsUsed++;
      }
    }
  }

  let paletteScore = 0;
  if (eligiblePaletteTones.size === 0) paletteScore = 20;
  else if (paletteColorsUsed >= 2) paletteScore = 25;
  else if (paletteColorsUsed === 1) paletteScore = 18;
  else paletteScore = 0;

  // 4. Alignment axes count (left, centre, right edges)
  // Single centre axis counts as clean so circle-badge-centre is not penalised
  const axes = new Set();
  const centerX = cardW / 2;

  for (const node of contentNodes) {
    const box = node.box;
    if (!box) continue;
    const nodeCenter = box.x + box.w / 2;

    if (node.anchor === "middle" || Math.abs(nodeCenter - centerX) <= 1.0) {
      // Aligns to center axis
      axes.add(`center:${Math.round(nodeCenter * 2) / 2}`);
    } else if (node.anchor === "end") {
      // Aligns to right edge
      axes.add(`right:${Math.round((box.x + box.w) * 2) / 2}`);
    } else {
      // Aligns to left edge
      axes.add(`left:${Math.round(box.x * 2) / 2}`);
    }
  }

  const axesCount = axes.size;
  let alignmentScore = 0;
  if (axesCount <= 2) alignmentScore = 25;
  else if (axesCount === 3) alignmentScore = 18;
  else if (axesCount === 4) alignmentScore = 10;
  else alignmentScore = 0;

  let total = ratioScore + whitespaceScore + paletteScore + alignmentScore;
  if (paletteScore === 0 && (palette.length > 0 || eligiblePaletteTones.size > 0)) {
    total = Math.min(60, total);
  }

  return {
    total,
    nameToRoleRatio: parseFloat(ratio.toFixed(2)),
    whitespaceShare: parseFloat(emptySpaceShare.toFixed(3)),
    alignmentAxes: axesCount,
    paletteColorsUsed,
    breakdown: {
      ratioScore,
      whitespaceScore,
      paletteScore,
      alignmentScore,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  Archetype Generators
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generates hero-photo-top archetype.
 * Large upper photo block (34-38 mm), bottom role edge bar, structured lower info zone.
 */
function generateHeroPhotoTop(event, prng, lookId, palette, requestedMode) {
  const { mode, fallback } = sampleModeForPalette(prng, palette, requestedMode);
  const photoClip = prng.choice(["rounded", "square"]);
  const headerStyle = prng.choice(["solid", "minimal", "none"]);
  const align = prng.choice(["left", "center"]);
  const photoH = prng.int(34, 35);
  const typePairKey = prng.choice(["space-grotesk", "source-serif"]);
  const typePair = FONT_PAIRINGS[typePairKey];

  const theme = deriveTheme(palette, mode, "event-led", `theme.${lookId}`);
  theme.fonts = { heading: typePair.heading, body: typePair.body };
  const roleColor = getRoleColor("participant", event);

  const skeletonId = `skel.${lookId}`;
  const infoH = 80.2 - (22 + photoH);
  const skeleton = {
    id: skeletonId,
    size: { w: 54, h: 85.6 },
    slots: {
      header: [0, 0, 54, 20],
      photo: [3, 21, 48, photoH],
      info: [3, 22 + photoH, 48, infoH],
      roleMarker: [0, 82.2, 54, 3.4],
    },
    supports: {
      orientation: ["portrait"],
      photo: true,
      qr: true,
    },
  };

  const blocks = {
    [`header.${lookId}`]: {
      id: `header.${lookId}`,
      slot: "header",
      elements: [
        ...(headerStyle === "solid"
          ? [{ id: "band", type: "rect", box: [0, 0, 100, 100], fill: "$theme.colors.accent", decor: true }]
          : []),
        { id: "logo1", type: "image", box: [6, 16, 26, 50], src: "$brand.logo.primary", plate: "shared" },
        { id: "logo2", type: "image", box: [68, 16, 26, 50], src: "$brand.logo.secondary", plate: "shared" },
        {
          id: "event-name",
          type: "text",
          bind: "event.name",
          font: "heading",
          box: [6, 70, 88, 25],
          size: [7, 6],
          maxLines: 2,
          align: "center",
          fill: headerStyle === "solid" ? "#FFFFFF" : "$theme.colors.text",
          optional: true,
        },
      ],
    },
    [`photo.${lookId}`]: {
      id: `photo.${lookId}`,
      slot: "photo",
      elements: [
        { id: "photo", type: "image", box: [0, 0, 100, 100], src: "$person.photo", clip: photoClip },
      ],
    },
    [`info.${lookId}`]: {
      id: `info.${lookId}`,
      slot: "info",
      elements: [
        {
          id: "name",
          type: "text",
          bind: "person.name",
          font: "heading",
          box: [2, 0, 96, (8.6 / infoH) * 100],
          size: [15, 9],
          oneLineFloor: 10,
          maxLines: 2,
          align,
          fill: "$theme.colors.text",
        },
        {
          id: "org",
          type: "text",
          bind: "person.org",
          font: "body",
          box: [2, (10.6 / infoH) * 100, 96, (2.2 / infoH) * 100],
          size: [6, 5.5],
          maxLines: 1,
          align,
          fill: "$theme.colors.text",
          optional: true,
        },
        {
          id: "role-pill",
          type: "rect",
          box: align === "center" ? [16, (14.8 / infoH) * 100, 68, (4.2 / infoH) * 100] : [2, (14.8 / infoH) * 100, 64, (4.2 / infoH) * 100],
          fill: "$role.color",
          radius: 2.5,
          decor: true,
        },
        {
          id: "role",
          type: "text",
          bind: "role.label",
          font: "body",
          box: align === "center" ? [16, (14.8 / infoH) * 100, 68, (4.2 / infoH) * 100] : [2, (14.8 / infoH) * 100, 64, (4.2 / infoH) * 100],
          size: [7.5, 7],
          maxLines: 1,
          align: "center",
          fill: "$role.contrast",
        },
        {
          id: "id-line",
          type: "text",
          bind: "person.id",
          font: "body",
          box: align === "center" ? [2, (21.0 / infoH) * 100, 96, (2.0 / infoH) * 100] : [2, (21.0 / infoH) * 100, 66, (2.0 / infoH) * 100],
          size: [5.5, 5.5],
          maxLines: 1,
          align,
          fill: "$theme.colors.text",
          optional: true,
        },
        {
          id: "qr-box",
          type: "rect",
          box: [76, (14.8 / infoH) * 100, 22, (8.2 / infoH) * 100],
          fill: "#F8FAFC",
          stroke: "#94A3B8",
          strokeWidth: 0.4,
          radius: 1,
          decor: false,
          optional: true,
        },
        {
          id: "qr-label",
          type: "text",
          bind: "qr",
          font: "body",
          maxLines: 1,
          box: [76, (14.8 / infoH) * 100, 22, (8.2 / infoH) * 100],
          size: [6.5, 6],
          align: "center",
          fill: "#475569",
          decor: true,
          optional: true,
        },
      ],
    },
    [`roleMarker.${lookId}`]: {
      id: `roleMarker.${lookId}`,
      slot: "roleMarker",
      elements: [
        { id: "role-bar", type: "rect", box: [0, 0, 100, 100], fill: "$role.color", decor: true },
      ],
    },
  };

  const look = {
    id: lookId,
    skeleton: skeletonId,
    theme: theme.id,
    blocks: {
      header: `header.${lookId}`,
      photo: `photo.${lookId}`,
      info: `info.${lookId}`,
      roleMarker: `roleMarker.${lookId}`,
    },
    attributes: {
      skeleton: "hero-photo-top",
      header: headerStyle,
      photo: photoClip,
      marker: "bottom-bar",
      theme: theme.id,
      mode,
      strategy: "event-led",
      typography: typePairKey,
      archetype: "hero-photo-top",
      modeFallback: fallback,
    },
    tags: ["hero", "bold", mode],
    requires: {
      orientation: ["portrait"],
      maxRoles: 6,
      needsPhotoSlot: false,
    },
  };

  return { skeleton, blocks, theme, look, archetype: "hero-photo-top", modeFallback: fallback };
}

/**
 * Generates colour-block-split archetype.
 * Distinct split between dominant palette color banner and neutral body, left role edge bar.
 */
function generateColourBlockSplit(event, prng, lookId, palette, requestedMode) {
  const { mode, fallback } = sampleModeForPalette(prng, palette, requestedMode);
  const photoClip = prng.choice(["rounded", "square"]);
  const headerStyle = prng.choice(["solid", "diagonal"]);
  const typePairKey = prng.choice(["space-grotesk", "source-serif"]);
  const typePair = FONT_PAIRINGS[typePairKey];

  const theme = deriveTheme(palette, mode, "event-led", `theme.${lookId}`);
  theme.fonts = { heading: typePair.heading, body: typePair.body };

  const skeletonId = `skel.${lookId}`;
  const skeleton = {
    id: skeletonId,
    size: { w: 54, h: 85.6 },
    slots: {
      roleMarker: [0, 0, 3.5, 85.6],
      header: [4, 0, 47, 20],
      photo: [14, 21, 27, 28],
      info: [4, 50, 47, 32],
    },
    supports: {
      orientation: ["portrait"],
      photo: true,
      qr: true,
    },
  };

  const blocks = {
    [`roleMarker.${lookId}`]: {
      id: `roleMarker.${lookId}`,
      slot: "roleMarker",
      elements: [
        { id: "role-bar", type: "rect", box: [0, 0, 100, 100], fill: "$role.color", decor: true },
      ],
    },
    [`header.${lookId}`]: {
      id: `header.${lookId}`,
      slot: "header",
      elements: [
        { id: "band", type: "rect", box: [0, 0, 100, 100], fill: "$theme.colors.accent", decor: true },
        { id: "logo1", type: "image", box: [0, 16, 28, 50], src: "$brand.logo.primary", plate: "shared" },
        { id: "logo2", type: "image", box: [72, 16, 28, 50], src: "$brand.logo.secondary", plate: "shared" },
        {
          id: "event-name",
          type: "text",
          bind: "event.name",
          font: "heading",
          box: [0, 70, 100, 25],
          size: [7, 6],
          maxLines: 2,
          align: "center",
          fill: "#FFFFFF",
          optional: true,
        },
      ],
    },
    [`photo.${lookId}`]: {
      id: `photo.${lookId}`,
      slot: "photo",
      elements: [
        { id: "photo", type: "image", box: [0, 0, 100, 100], src: "$person.photo", clip: photoClip },
      ],
    },
    [`info.${lookId}`]: {
      id: `info.${lookId}`,
      slot: "info",
      elements: [
        {
          id: "name",
          type: "text",
          bind: "person.name",
          font: "heading",
          box: [2, 0, 96, (8.6 / 32) * 100],
          size: [15, 9],
          oneLineFloor: 10,
          maxLines: 2,
          align: "center",
          fill: "$theme.colors.text",
        },
        {
          id: "org",
          type: "text",
          bind: "person.org",
          font: "body",
          box: [2, (10.6 / 32) * 100, 96, (2.2 / 32) * 100],
          size: [6, 5.5],
          maxLines: 1,
          align: "center",
          fill: "$theme.colors.text",
          optional: true,
        },
        {
          id: "role-pill",
          type: "rect",
          box: [12, (14.8 / 32) * 100, 76, (4.2 / 32) * 100],
          fill: "$role.color",
          radius: 2.5,
          decor: true,
        },
        {
          id: "role",
          type: "text",
          bind: "role.label",
          font: "body",
          box: [12, (14.8 / 32) * 100, 76, (4.2 / 32) * 100],
          size: [7.5, 7],
          maxLines: 1,
          align: "center",
          fill: "$role.contrast",
        },
        {
          id: "id-line",
          type: "text",
          bind: "person.id",
          font: "body",
          box: [2, (21.0 / 32) * 100, 96, (2.0 / 32) * 100],
          size: [5.5, 5.5],
          maxLines: 1,
          align: "center",
          fill: "$theme.colors.text",
          optional: true,
        },
        {
          id: "qr-box",
          type: "rect",
          box: [76, (14.8 / 32) * 100, 22, (8.2 / 32) * 100],
          fill: "#F8FAFC",
          stroke: "#94A3B8",
          strokeWidth: 0.4,
          radius: 1,
          decor: false,
          optional: true,
        },
        {
          id: "qr-label",
          type: "text",
          bind: "qr",
          font: "body",
          maxLines: 1,
          box: [76, (14.8 / 32) * 100, 22, (8.2 / 32) * 100],
          size: [6.5, 6],
          align: "center",
          fill: "#475569",
          decor: true,
          optional: true,
        },
      ],
    },
  };

  const look = {
    id: lookId,
    skeleton: skeletonId,
    theme: theme.id,
    blocks: {
      roleMarker: `roleMarker.${lookId}`,
      header: `header.${lookId}`,
      photo: `photo.${lookId}`,
      info: `info.${lookId}`,
    },
    attributes: {
      skeleton: "colour-block-split",
      header: headerStyle,
      photo: photoClip,
      marker: "side-stripe",
      theme: theme.id,
      mode,
      strategy: "event-led",
      typography: typePairKey,
      archetype: "colour-block-split",
      modeFallback: fallback,
    },
    tags: ["split", "colour-block", mode],
    requires: {
      orientation: ["portrait"],
      maxRoles: 6,
      needsPhotoSlot: false,
    },
  };

  return { skeleton, blocks, theme, look, archetype: "colour-block-split", modeFallback: fallback };
}

/**
 * Generates circle-badge-centre archetype.
 * Centered circular badge, bottom role edge bar, clean header with zero intersecting lines.
 */
function generateCircleBadgeCentre(event, prng, lookId, palette, requestedMode) {
  const { mode, fallback } = sampleModeForPalette(prng, palette, requestedMode);
  const badgeSize = prng.int(28, 32);
  const badgeX = (54 - badgeSize) / 2;
  const typePairKey = prng.choice(["space-grotesk", "source-serif"]);
  const typePair = FONT_PAIRINGS[typePairKey];

  const theme = deriveTheme(palette, mode, "role-led", `theme.${lookId}`);
  theme.fonts = { heading: typePair.heading, body: typePair.body };

  const skeletonId = `skel.${lookId}`;
  const infoH = 80.2 - (22 + badgeSize);
  const skeleton = {
    id: skeletonId,
    size: { w: 54, h: 85.6 },
    slots: {
      header: [0, 0, 54, 20],
      photo: [badgeX, 21, badgeSize, badgeSize],
      info: [3, 22 + badgeSize, 48, infoH],
      roleMarker: [0, 82.2, 54, 3.4],
    },
    supports: {
      orientation: ["portrait"],
      photo: true,
      qr: true,
    },
  };

  const blocks = {
    [`roleMarker.${lookId}`]: {
      id: `roleMarker.${lookId}`,
      slot: "roleMarker",
      elements: [
        { id: "role-bar", type: "rect", box: [0, 0, 100, 100], fill: "$role.color", decor: true },
      ],
    },
    [`header.${lookId}`]: {
      id: `header.${lookId}`,
      slot: "header",
      elements: [
        // Clean header: NO thin line cutting across the circle badge!
        { id: "logo1", type: "image", box: [6, 16, 26, 50], src: "$brand.logo.primary", plate: "shared" },
        { id: "logo2", type: "image", box: [68, 16, 26, 50], src: "$brand.logo.secondary", plate: "shared" },
        {
          id: "event-name",
          type: "text",
          bind: "event.name",
          font: "heading",
          box: [6, 70, 88, 25],
          size: [7, 6],
          maxLines: 2,
          align: "center",
          fill: "$theme.colors.accent",
          optional: true,
        },
      ],
    },
    [`photo.${lookId}`]: {
      id: `photo.${lookId}`,
      slot: "photo",
      elements: [
        { id: "ring", type: "rect", box: [0, 0, 100, 100], fill: "$theme.colors.accent", radius: badgeSize / 2, decor: true },
        { id: "photo", type: "image", box: [4, 4, 92, 92], src: "$person.photo", clip: "circle" },
      ],
    },
    [`info.${lookId}`]: {
      id: `info.${lookId}`,
      slot: "info",
      elements: [
        {
          id: "name",
          type: "text",
          bind: "person.name",
          font: "heading",
          box: [2, 0, 96, (8.6 / infoH) * 100],
          size: [15, 9],
          oneLineFloor: 10,
          maxLines: 2,
          align: "center",
          fill: "$theme.colors.text",
        },
        {
          id: "org",
          type: "text",
          bind: "person.org",
          font: "body",
          box: [2, (10.6 / infoH) * 100, 96, (2.2 / infoH) * 100],
          size: [6, 5.5],
          maxLines: 1,
          align: "center",
          fill: "$theme.colors.text",
          optional: true,
        },
        {
          id: "role-pill",
          type: "rect",
          box: [14, (14.8 / infoH) * 100, 72, (4.2 / infoH) * 100],
          fill: "$role.color",
          radius: 2.5,
          decor: true,
        },
        {
          id: "role",
          type: "text",
          bind: "role.label",
          font: "body",
          box: [14, (14.8 / infoH) * 100, 72, (4.2 / infoH) * 100],
          size: [7.5, 7],
          maxLines: 1,
          align: "center",
          fill: "$role.contrast",
        },
        {
          id: "id-line",
          type: "text",
          bind: "person.id",
          font: "body",
          box: [2, (21.0 / infoH) * 100, 96, (2.0 / infoH) * 100],
          size: [5.5, 5.5],
          maxLines: 1,
          align: "center",
          fill: "$theme.colors.text",
          optional: true,
        },
        {
          id: "qr-box",
          type: "rect",
          box: [78, (14.8 / infoH) * 100, 20, (8.2 / infoH) * 100],
          fill: "#F8FAFC",
          stroke: "#94A3B8",
          strokeWidth: 0.4,
          radius: 1,
          decor: false,
          optional: true,
        },
        {
          id: "qr-label",
          type: "text",
          bind: "qr",
          font: "body",
          maxLines: 1,
          box: [78, (14.8 / infoH) * 100, 20, (8.2 / infoH) * 100],
          size: [6.5, 6],
          align: "center",
          fill: "#475569",
          decor: true,
          optional: true,
        },
      ],
    },
  };

  const look = {
    id: lookId,
    skeleton: skeletonId,
    theme: theme.id,
    blocks: {
      roleMarker: `roleMarker.${lookId}`,
      header: `header.${lookId}`,
      photo: `photo.${lookId}`,
      info: `info.${lookId}`,
    },
    attributes: {
      skeleton: "circle-badge-centre",
      header: "clean",
      photo: "circle",
      marker: "bottom-bar",
      theme: theme.id,
      mode,
      strategy: "role-led",
      typography: typePairKey,
      archetype: "circle-badge-centre",
      modeFallback: fallback,
    },
    tags: ["circle", "badge", mode],
    requires: {
      orientation: ["portrait"],
      maxRoles: 6,
      needsPhotoSlot: false,
    },
  };

  return { skeleton, blocks, theme, look, archetype: "circle-badge-centre", modeFallback: fallback };
}

/**
 * Generates typographic-name-first archetype.
 * Attendee name commands immediate focus near top with side-by-side photo and metadata.
 */
function generateTypographicNameFirst(event, prng, lookId, palette, requestedMode) {
  const { mode, fallback } = sampleModeForPalette(prng, palette, requestedMode);
  const photoClip = prng.choice(["rounded", "square"]);
  const mirrored = prng.bool(0.5);
  const photoW = 23;
  const photoH = 29;
  const typePairKey = prng.choice(["source-serif", "space-grotesk"]);
  const typePair = FONT_PAIRINGS[typePairKey];

  const theme = deriveTheme(palette, mode, "event-led", `theme.${lookId}`);
  theme.fonts = { heading: typePair.heading, body: typePair.body };

  const skeletonId = `skel.${lookId}`;
  const skeleton = {
    id: skeletonId,
    size: { w: 54, h: 85.6 },
    slots: {
      roleMarker: [0, 0, 3.5, 85.6],
      header: [4, 0, 47, 20],
      title: [5, 21, 45, 24],
      photo: mirrored ? [5, 46, photoW, photoH] : [28, 46, photoW, photoH],
      meta: mirrored ? [29, 46, 21, photoH] : [5, 46, 21, photoH],
      footer: [5, 76, 45, 6],
    },
    supports: {
      orientation: ["portrait"],
      photo: true,
      qr: true,
    },
  };

  const blocks = {
    [`roleMarker.${lookId}`]: {
      id: `roleMarker.${lookId}`,
      slot: "roleMarker",
      elements: [
        { id: "role-bar", type: "rect", box: [0, 0, 100, 100], fill: "$role.color", decor: true },
      ],
    },
    [`header.${lookId}`]: {
      id: `header.${lookId}`,
      slot: "header",
      elements: [
        { id: "logo1", type: "image", box: [0, 16, 28, 50], src: "$brand.logo.primary", plate: "shared" },
        { id: "logo2", type: "image", box: [72, 16, 28, 50], src: "$brand.logo.secondary", plate: "shared" },
        {
          id: "event-name",
          type: "text",
          bind: "event.name",
          font: "heading",
          box: [0, 70, 100, 25],
          size: [7, 6],
          maxLines: 2,
          align: "center",
          fill: "$theme.colors.accent",
          optional: true,
        },
      ],
    },
    [`title.${lookId}`]: {
      id: `title.${lookId}`,
      slot: "title",
      elements: [
        {
          id: "name",
          type: "text",
          bind: "person.name",
          font: "heading",
          box: [0, 0, 100, (9.0 / 24) * 100],
          size: [16, 9.5],
          oneLineFloor: 10,
          maxLines: 2,
          align: "left",
          fill: "$theme.colors.text",
        },
        {
          id: "role-pill",
          type: "rect",
          box: [0, (11.2 / 24) * 100, 68, (4.2 / 24) * 100],
          fill: "$role.color",
          radius: 2.5,
          decor: true,
        },
        {
          id: "role",
          type: "text",
          bind: "role.label",
          font: "body",
          box: [0, (11.2 / 24) * 100, 68, (4.2 / 24) * 100],
          size: [7.5, 7],
          maxLines: 1,
          align: "center",
          fill: "$role.contrast",
        },
      ],
    },
    [`photo.${lookId}`]: {
      id: `photo.${lookId}`,
      slot: "photo",
      elements: [
        { id: "photo", type: "image", box: [0, 0, 100, 100], src: "$person.photo", clip: photoClip },
      ],
    },
    [`meta.${lookId}`]: {
      id: `meta.${lookId}`,
      slot: "meta",
      elements: [
        {
          id: "org",
          type: "text",
          bind: "person.org",
          font: "body",
          box: [0, 0, 100, (4.5 / 29) * 100],
          size: [7, 5.5],
          maxLines: 2,
          align: "left",
          fill: "$theme.colors.text",
          optional: true,
        },
        {
          id: "id-line",
          type: "text",
          bind: "person.id",
          font: "body",
          box: [0, (6.5 / 29) * 100, 100, (2.2 / 29) * 100],
          size: [5.5, 5.5],
          maxLines: 1,
          align: "left",
          fill: "$theme.colors.text",
          optional: true,
        },
        {
          id: "qr-box",
          type: "rect",
          box: [0, (10.7 / 29) * 100, 56, (10.0 / 29) * 100],
          fill: "#F8FAFC",
          stroke: "#94A3B8",
          strokeWidth: 0.4,
          radius: 1,
          decor: false,
          optional: true,
        },
        {
          id: "qr-label",
          type: "text",
          bind: "qr",
          font: "body",
          maxLines: 1,
          box: [0, (10.7 / 29) * 100, 56, (10.0 / 29) * 100],
          size: [6.5, 6],
          align: "center",
          fill: "#475569",
          decor: true,
          optional: true,
        },
      ],
    },
    [`footer.${lookId}`]: {
      id: `footer.${lookId}`,
      slot: "footer",
      elements: [
        {
          id: "venue-label",
          type: "text",
          bind: "event.venue",
          font: "body",
          box: [0, 0, 100, 100],
          size: [6, 5.5],
          maxLines: 1,
          align: "left",
          fill: "$theme.colors.text",
          optional: true,
        },
      ],
    },
  };

  const look = {
    id: lookId,
    skeleton: skeletonId,
    theme: theme.id,
    blocks: {
      roleMarker: `roleMarker.${lookId}`,
      header: `header.${lookId}`,
      title: `title.${lookId}`,
      photo: `photo.${lookId}`,
      meta: `meta.${lookId}`,
      footer: `footer.${lookId}`,
    },
    attributes: {
      skeleton: "typographic-name-first",
      header: "minimal",
      photo: photoClip,
      marker: "side-stripe",
      theme: theme.id,
      mode,
      strategy: "event-led",
      typography: typePairKey,
      archetype: "typographic-name-first",
      modeFallback: fallback,
    },
    tags: ["editorial", "typographic", mode],
    requires: {
      orientation: ["portrait"],
      maxRoles: 6,
      needsPhotoSlot: false,
    },
  };

  return { skeleton, blocks, theme, look, archetype: "typographic-name-first", modeFallback: fallback };
}

/**
 * Pure composer: generates full { skeleton, blocks, theme, look } from event and seed.
 * Deterministic: same event + same seed = identical output.
 *
 * @param {Record<string, any>} event - Event specification
 * @param {string | number} seed - Deterministic PRNG seed
 * @param {string} [forcedArchetype] - Optional archetype override
 * @param {string} [forcedMode] - Optional mode override
 * @returns {{
 *   skeleton: any,
 *   blocks: Record<string, any>,
 *   theme: any,
 *   look: any,
 *   seed: string | number,
 *   archetype: string,
 *   modeFallback?: boolean,
 * }}
 */
export function compose(event, seed, forcedArchetype, forcedMode) {
  const prng = createPrng(seed);
  const lookId = `composed.${hashSeed(seed).toString(16).slice(0, 8)}`;

  // Resolve event palette (1 to 3 colours)
  const rawPalette =
    event?.event?.palette ||
    event?.palette ||
    ["#0A192F", "#FF6B35"];
  const palette = Array.isArray(rawPalette) && rawPalette.length > 0
    ? rawPalette
    : ["#0A192F", "#FF6B35"];

  const archetype = forcedArchetype || prng.choice(ARCHETYPES);

  let bundle;
  switch (archetype) {
    case "hero-photo-top":
      bundle = generateHeroPhotoTop(event, prng, lookId, palette, forcedMode);
      break;
    case "colour-block-split":
      bundle = generateColourBlockSplit(event, prng, lookId, palette, forcedMode);
      break;
    case "circle-badge-centre":
      bundle = generateCircleBadgeCentre(event, prng, lookId, palette, forcedMode);
      break;
    case "typographic-name-first":
    default:
      bundle = generateTypographicNameFirst(event, prng, lookId, palette, forcedMode);
      break;
  }

  // Attach seed to look for full persistence & traceability
  bundle.look.seed = seed;
  bundle.seed = seed;

  return bundle;
}

/**
 * Checks whether two composed drafts differ in at least 2 key design parameters.
 *
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
export function differInAtLeast2Params(a, b) {
  let diffs = 0;
  if (a.look?.attributes?.mode !== b.look?.attributes?.mode) diffs++;
  if (a.look?.attributes?.photo !== b.look?.attributes?.photo) diffs++;
  if (a.look?.attributes?.header !== b.look?.attributes?.header) diffs++;
  if (a.look?.attributes?.marker !== b.look?.attributes?.marker) diffs++;
  if (a.look?.attributes?.strategy !== b.look?.attributes?.strategy) diffs++;
  if (a.look?.attributes?.skeleton !== b.look?.attributes?.skeleton) diffs++;
  if (a.look?.attributes?.typography !== b.look?.attributes?.typography) diffs++;
  return diffs >= 2;
}

/**
 * Composes, validates, scores, and selects distinct drafts for an event.
 * Pure function: takes seed as an argument and never invokes Math.random or Date.now.
 *
 * Selection Rules:
 * - 3 drafts use 3 DIFFERENT archetypes when possible.
 * - 3 drafts differ in ALL of: archetype, mode, and typography.
 * - Every pair must satisfy distance >= 5.
 *
 * @param {Record<string, any>} event
 * @param {{
 *   seed: string | number,
 *   previousArchetypes?: string[],
 *   previousSeeds?: Array<string | number>,
 *   count?: number,
 *   sampleSize?: number,
 *   font?: any,
 *   brand?: any,
 *   stressSet?: any[],
 * }} options
 * @returns {{
 *   drafts: Array<{
 *     skeleton: any,
 *     blocks: Record<string, any>,
 *     theme: any,
 *     look: any,
 *     seed: string | number,
 *     archetype: string,
 *     score: number,
 *     scoreDetails: any,
 *     scene?: any,
 *     svg?: string,
 *     modeFallback?: boolean,
 *   }>,
 *   seed: string | number,
 * }}
 */
export function composeDrafts(event, options) {
  const seed = options.seed !== undefined ? options.seed : 42;
  const previousArchetypes = options.previousArchetypes || [];
  const sampleSize = options.sampleSize || 24;
  const count = options.count || 3;
  const font = options.font || null;
  const fontRegistry = options.fontRegistry || null;
  const brand = options.brand || null;
  const dataset = options.stressSet || stressSet;

  const rawPalette =
    event?.event?.palette ||
    event?.palette ||
    ["#0A192F", "#FF6B35"];
  const palette = Array.isArray(rawPalette) && rawPalette.length > 0
    ? rawPalette
    : ["#0A192F", "#FF6B35"];

  const modes = ["light", "dark", "colour-field"];

  /** @type {any[]} */
  const candidates = [];
  /** @type {any[]} */
  const dataErrors = [];
  const qrEnabled = event?.qr?.enabled ?? event?.event?.qr?.enabled ?? true;

  // Generate candidate pool cycling across all 4 archetypes and modes
  for (let i = 0; i < sampleSize; i++) {
    const subSeed = `${seed}-${i}`;
    const archetype = ARCHETYPES[i % ARCHETYPES.length];
    const mode = modes[Math.floor(i / ARCHETYPES.length) % modes.length];
    const candidate = compose(event, subSeed, archetype, mode);
    const candidateFonts = fontRegistry?.[candidate.look.attributes.typography] || options.fonts || (font ? { heading: font, body: font } : undefined);

    // Validate against stress set: drop any candidate with validator errors
    let passesStress = true;
    let sampleScene = null;
    let sampleSvg = null;
    /** @type {any[]} */
    const candidateIssues = [];

    for (const person of dataset) {
      const res = renderCard({
        person,
        event,
        brand,
        card: event?.card,
        font,
        fonts: candidateFonts,
        skeleton: candidate.skeleton,
        blocks: candidate.blocks,
        theme: candidate.theme,
        look: candidate.look,
      });

      // Collect issues for this candidate
      for (const iss of res.issues || []) {
        if (!candidateIssues.some((ci) => ci.code === iss.code && ci.message === iss.message && ci.nodeId === iss.nodeId)) {
          candidateIssues.push(iss);
        }
      }

      // Check if QR was hidden via the QR_TOO_SMALL autofix path
      if (qrEnabled) {
        const qrHiddenViaAutofix = (res.fixes || []).some(
          (f) => f.code === "QR_TOO_SMALL" || (f.nodeId && f.nodeId.includes("qr"))
        );
        if (qrHiddenViaAutofix && !candidateIssues.some((ci) => ci.code === "ELEMENT_DROPPED" && ci.nodeId === "qr")) {
          candidateIssues.push({
            code: "ELEMENT_DROPPED",
            severity: "warning",
            nodeId: "qr",
            message: `Element 'qr' dropped on card for person '${person.id || person.name || "unknown"}' (hidden via QR_TOO_SMALL autofix to satisfy minimum 15x15 mm)`,
          });
        }
      }

      const errors = (res.issues || []).filter((iss) => iss.severity === "error");
      if (errors.length > 0) {
        for (const err of errors) {
          if (!dataErrors.some((de) => de.code === err.code && de.message === err.message)) {
            dataErrors.push(err);
          }
        }
        // Only layout/design errors disqualify a candidate template from passing stress tests.
        // Participant data errors (such as UNKNOWN_ROLE_ID) are surfaced in result.issues,
        // but must NOT hide the designs (bad data must be shown on the card, not hide the drafts).
        const designErrors = errors.filter((iss) => iss.code !== "UNKNOWN_ROLE_ID");
        if (designErrors.length > 0) {
          passesStress = false;
          break;
        }
      }

      if (!sampleScene) {
        sampleScene = res.scene;
        sampleSvg = res.svg;
      }
    }

    if (!passesStress) continue;

    // Quality score
    const quality = scoreQuality(sampleScene, { card: event?.card, palette, event, theme: candidate.theme, mode });

    candidates.push({
      ...candidate,
      score: quality.total,
      scoreDetails: quality,
      scene: sampleScene,
      svg: sampleSvg,
      fonts: candidateFonts,
      issues: candidateIssues,
    });
  }

  /**
   * Assembles result.issues containing only the issues of the chosen drafts plus data errors (D-39 / Condition 2).
   * Warnings from rejected candidates are excluded.
   *
   * @param {any[]} chosenDrafts
   * @returns {any[]}
   */
  const assembleResultIssues = (chosenDrafts) => {
    /** @type {any[]} */
    const resultIssues = [];
    const add = (iss) => {
      if (!resultIssues.some((ri) => ri.code === iss.code && ri.message === iss.message && ri.nodeId === iss.nodeId)) {
        resultIssues.push(iss);
      }
    };
    for (const de of dataErrors) {
      add(de);
    }
    for (const draft of chosenDrafts) {
      for (const iss of draft.issues || []) {
        add(iss);
      }
    }
    return resultIssues;
  };

  if (candidates.length < count) {
    return { drafts: candidates, seed, issues: assembleResultIssues(candidates) };
  }

  if (count === 1) {
    const sorted = [...candidates].sort((a, b) => {
      const aUnseen = !previousArchetypes.includes(a.archetype);
      const bUnseen = !previousArchetypes.includes(b.archetype);
      if (aUnseen !== bUnseen) return aUnseen ? -1 : 1;
      return b.score - a.score;
    });
    const picked = sorted.slice(0, 1);
    return { drafts: picked, seed, issues: assembleResultIssues(picked) };
  }

  if (count === 2) {
    let bestPair = null;
    let bestScore = -1;
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        if (distance(candidates[i].look, candidates[j].look) >= MIN_PAIR_DISTANCE) {
          const s = candidates[i].score + candidates[j].score;
          if (s > bestScore) {
            bestScore = s;
            bestPair = [candidates[i], candidates[j]];
          }
        }
      }
    }
    const picked = bestPair || candidates.slice(0, 2);
    return { drafts: picked, seed, issues: assembleResultIssues(picked) };
  }

  // Find candidate triplets satisfying distinctness rules
  /** @type {any[]} */
  const validTriplets = [];

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      for (let k = j + 1; k < candidates.length; k++) {
        const c1 = candidates[i];
        const c2 = candidates[j];
        const c3 = candidates[k];

        // 1. Every pair must have distance >= 5
        const d12 = distance(c1.look, c2.look);
        const d13 = distance(c1.look, c3.look);
        const d23 = distance(c2.look, c3.look);

        if (d12 < MIN_PAIR_DISTANCE || d13 < MIN_PAIR_DISTANCE || d23 < MIN_PAIR_DISTANCE) {
          continue;
        }

        // Count unique archetypes
        const uniqueArchetypes = new Set([c1.archetype, c2.archetype, c3.archetype]).size;

        // If archetypes repeat, must differ in at least 2 parameters
        if (c1.archetype === c2.archetype && !differInAtLeast2Params(c1, c2)) continue;
        if (c1.archetype === c3.archetype && !differInAtLeast2Params(c1, c3)) continue;
        if (c2.archetype === c3.archetype && !differInAtLeast2Params(c2, c3)) continue;

        // Count unique modes
        const uniqueModes = new Set([
          c1.look.attributes.mode,
          c2.look.attributes.mode,
          c3.look.attributes.mode,
        ]).size;

        // Count archetypes not in previousArchetypes
        const unseenArchetypes = [c1, c2, c3].filter(
          (c) => !previousArchetypes.includes(c.archetype)
        ).length;

        // Count unique typographies
        const uniqueTypographies = new Set([
          c1.look.attributes.typography,
          c2.look.attributes.typography,
          c3.look.attributes.typography,
        ]).size;

        let totalScore = c1.score + c2.score + c3.score;
        // Reward 3 distinct modes (light, dark, colour-field)
        if (uniqueModes === 3) totalScore += 15;
        // Penalise two drafts sharing mode
        if (uniqueModes < 3) totalScore -= 20;
        // Reward variety in typography
        if (uniqueTypographies >= 2) totalScore += 10;

        validTriplets.push({
          triplet: [c1, c2, c3],
          uniqueArchetypes,
          uniqueModes,
          uniqueTypographies,
          unseenArchetypes,
          totalScore,
        });
      }
    }
  }

  if (validTriplets.length === 0) {
    const top = candidates.sort((a, b) => b.score - a.score).slice(0, count);
    return { drafts: top, seed, issues: assembleResultIssues(top) };
  }

  // Sort triplets:
  // 1. Maximize unique archetypes (3 distinct preferred)
  // 2. Maximize unique modes (1 light, 1 dark, 1 colour-field preferred)
  // 3. Maximize unseen archetypes from previousArchetypes
  // 4. Maximize total quality score
  validTriplets.sort((a, b) => {
    if (a.uniqueArchetypes !== b.uniqueArchetypes) {
      return b.uniqueArchetypes - a.uniqueArchetypes;
    }
    if (a.uniqueModes !== b.uniqueModes) {
      return b.uniqueModes - a.uniqueModes;
    }
    if (a.unseenArchetypes !== b.unseenArchetypes) {
      return b.unseenArchetypes - a.unseenArchetypes;
    }
    return b.totalScore - a.totalScore;
  });

  const picked = validTriplets[0].triplet;
  return { drafts: picked, seed, issues: assembleResultIssues(picked) };
}
