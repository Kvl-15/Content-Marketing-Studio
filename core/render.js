// @ts-check
import {
  defaultBlocks,
  defaultLook,
  defaultSkeleton,
  defaultTheme,
} from "./templateData.js";

/**
 * @module core/render
 */

/**
 * Escapes XML/SVG special characters so text nodes always emit valid XML.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  return String(str).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}

/**
 * Converts percentage box [x, y, w, h] of a slot into millimeters on the card.
 *
 * @param {[number, number, number, number]} pct
 * @param {[number, number, number, number]} slot
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
function toAbsolute(pct, slot) {
  return {
    x: slot[0] + (pct[0] / 100) * slot[2],
    y: slot[1] + (pct[1] / 100) * slot[3],
    w: (pct[2] / 100) * slot[2],
    h: (pct[3] / 100) * slot[3],
  };
}

/**
 * Renders an ID card into an SVG, scene graph, and issue list.
 * First real vertical slice: renders look.bold deterministically.
 *
 * @param {Record<string, any>} input
 * @returns {{ svg: string, scene: import("./schemas.js").SceneNode extends import("zod").ZodType<infer T> ? T[] : any[], issues: import("./schemas.js").Issue extends import("zod").ZodType<infer T> ? T[] : any[] }}
 */
export function renderCard(input) {
  const skeleton = input.skeleton || defaultSkeleton;
  const theme = input.theme || defaultTheme;
  const brand = input.brand || null;
  const event = input.event || null;
  const person = input.person || { id: "HX26-P-000", name: "Participant", roleId: "participant" };

  const orientation = input.card?.orientation || "portrait";
  const isLandscape = orientation === "landscape";
  const widthMm = input.card?.widthMm ?? (isLandscape ? skeleton.size.h : skeleton.size.w);
  const heightMm = input.card?.heightMm ?? (isLandscape ? skeleton.size.w : skeleton.size.h);

  // 1. Resolve role details from event
  const roleMatch = event?.roles?.find((/** @type {any} */ r) => r.id === person.roleId);
  const roleLabel = roleMatch?.label || person.roleId?.toUpperCase() || "PARTICIPANT";
  const roleColor = roleMatch?.color?.value || "#2563EB";

  // 2. Resolve theme colors and fonts
  const bgColor = theme.colors.background === "$brand.palette.light"
    ? (brand?.palette?.light || "#FFFFFF")
    : (theme.colors.background || "#FFFFFF");

  const textColor = theme.colors.text === "$brand.palette.dark"
    ? (brand?.palette?.dark || "#111827")
    : (theme.colors.text || "#111827");

  const headingFont = theme.fonts.heading.startsWith("$brand.fonts.")
    ? (brand?.fonts?.heading || "sans-serif")
    : (theme.fonts.heading || "sans-serif");

  const bodyFont = theme.fonts.body.startsWith("$brand.fonts.")
    ? (brand?.fonts?.body || "sans-serif")
    : (theme.fonts.body || "sans-serif");

  // 3. Assemble scene nodes (Boxes in mm)
  const headerSlot = skeleton.slots.header;
  const photoSlot = skeleton.slots.photo;
  const infoSlot = skeleton.slots.info;
  const markerSlot = skeleton.slots.roleMarker;

  // Convert typographic point sizes to mm (1 pt = 0.3528 mm)
  const nameSizeMm = 9 * 0.3528;
  const roleSizeMm = 6 * 0.3528;

  /** @type {any[]} */
  const scene = [
    // Card background
    {
      type: "rect",
      id: "bg",
      box: { x: 0, y: 0, w: widthMm, h: heightMm },
      fill: bgColor,
    },
    // Header band (colored by role)
    {
      type: "rect",
      id: "band",
      box: toAbsolute([0, 0, 100, 100], headerSlot),
      fill: roleColor,
    },
    // Primary logo placeholder
    {
      type: "rect",
      id: "logo1",
      box: toAbsolute([6, 15, 38, 70], headerSlot),
      fill: "#D1D5DB",
    },
    // Secondary logo placeholder
    {
      type: "rect",
      id: "logo2",
      box: toAbsolute([56, 15, 38, 70], headerSlot),
      fill: "#D1D5DB",
    },
    // Photo placeholder (rounded rect)
    {
      type: "rect",
      id: "photo",
      box: toAbsolute([0, 0, 100, 100], photoSlot),
      fill: "#E5E7EB",
      radius: 4,
    },
    // Person name text
    {
      type: "text",
      id: "name",
      box: toAbsolute([0, 10, 100, 50], infoSlot),
      lines: [person.name || ""],
      sizeMm: nameSizeMm,
      font: headingFont,
      fill: textColor,
      anchor: "middle",
      status: "ok",
    },
    // Role label text
    {
      type: "text",
      id: "role",
      box: toAbsolute([0, 65, 100, 30], infoSlot),
      lines: [roleLabel],
      sizeMm: roleSizeMm,
      font: bodyFont,
      fill: textColor,
      anchor: "middle",
      status: "ok",
    },
    // Bottom marker bar (colored by role)
    {
      type: "rect",
      id: "bar",
      box: toAbsolute([0, 0, 100, 100], markerSlot),
      fill: roleColor,
    },
  ];

  // 4. Emit SVG strictly from the scene nodes
  const svgElements = scene.map((node) => {
    if (node.type === "rect") {
      const radiusAttr = node.radius ? ` rx="${node.radius}" ry="${node.radius}"` : "";
      return `<rect id="${node.id}" x="${node.box.x}" y="${node.box.y}" width="${node.box.w}" height="${node.box.h}" fill="${node.fill}"${radiusAttr}/>`;
    }
    if (node.type === "text") {
      let x = node.box.x;
      if (node.anchor === "middle") {
        x = node.box.x + node.box.w / 2;
      } else if (node.anchor === "end") {
        x = node.box.x + node.box.w;
      }
      const y = node.box.y + node.sizeMm * 0.85;
      const textContent = escapeXml(node.lines[0] || "");
      return `<text id="${node.id}" x="${x}" y="${y}" fill="${node.fill}" font-family="${escapeXml(node.font)}" font-size="${node.sizeMm}" text-anchor="${node.anchor}">${textContent}</text>`;
    }
    return "";
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}">${svgElements.join("")}</svg>`;

  /** @type {any[]} */
  const issues = [];

  return { svg, scene, issues };
}
