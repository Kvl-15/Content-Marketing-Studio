// @ts-check
import { autofix } from "./autofix.js";
import {
  defaultBlocks,
  defaultLook,
  defaultSkeleton,
  defaultTheme,
} from "./templateData.js";
import { fitText, PT_TO_MM } from "./text.js";
import { LINE_HEIGHT, validate } from "./validate.js";

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

  // 2. Resolve theme colors
  const bgColor = theme.colors.background === "$brand.palette.light"
    ? (brand?.palette?.light || "#FFFFFF")
    : (theme.colors.background || "#FFFFFF");

  const textColor = theme.colors.text === "$brand.palette.dark"
    ? (brand?.palette?.dark || "#111827")
    : (theme.colors.text || "#111827");

  // 3. Resolve fonts
  const fontObj = input.font || input.fonts?.heading || (input.fonts && Object.values(input.fonts)[0]);
  const bodyFontObj = input.fonts?.body || fontObj;

  const headingFontFamily = fontObj?.names?.fontFamily?.en
    || (theme.fonts.heading.startsWith("$brand.fonts.")
      ? (brand?.fonts?.heading || "sans-serif")
      : (theme.fonts.heading || "sans-serif"));

  const bodyFontFamily = bodyFontObj?.names?.fontFamily?.en
    || (theme.fonts.body.startsWith("$brand.fonts.")
      ? (brand?.fonts?.body || "sans-serif")
      : (theme.fonts.body || "sans-serif"));

  // 4. Slots in mm
  const headerSlot = skeleton.slots.header;
  const photoSlot = skeleton.slots.photo;
  const infoSlot = skeleton.slots.info;
  const markerSlot = skeleton.slots.roleMarker;

  const infoBlock = defaultBlocks["info.centered"];
  const nameElement = infoBlock.elements.find((/** @type {any} */ el) => el.id === "name");
  const roleElement = infoBlock.elements.find((/** @type {any} */ el) => el.id === "role");

  const nameBox = toAbsolute(nameElement.box, infoSlot);
  const roleBox = toAbsolute(roleElement.box, infoSlot);

  // 5. Fit text using opentype font (if provided) following D-20
  /** @type {{ lines: string[], sizeMm: number, status: "ok" | "truncated" }} */
  let nameFit;
  if (fontObj) {
    nameFit = fitText({
      text: person.name || "",
      boxWidthMm: nameBox.w,
      boxHeightMm: nameBox.h,
      sizeRangePt: nameElement.size, // [9, 6.5]
      oneLineFloorPt: nameElement.oneLineFloor, // 7.5
      maxLines: nameElement.maxLines || 2,
      font: fontObj,
    });
  } else {
    nameFit = {
      lines: [person.name || ""],
      sizeMm: nameElement.size[0] * PT_TO_MM,
      status: "ok",
    };
  }

  /** @type {{ lines: string[], sizeMm: number, status: "ok" | "truncated" }} */
  let roleFit;
  if (bodyFontObj) {
    roleFit = fitText({
      text: roleLabel,
      boxWidthMm: roleBox.w,
      boxHeightMm: roleBox.h,
      sizeRangePt: roleElement.size, // [6, 4]
      oneLineFloorPt: roleElement.oneLineFloor,
      maxLines: roleElement.maxLines || 1,
      font: bodyFontObj,
    });
  } else {
    roleFit = {
      lines: [roleLabel],
      sizeMm: roleElement.size[0] * PT_TO_MM,
      status: "ok",
    };
  }

  // 6. Assemble scene graph
  /** @type {any[]} */
  let scene = [
    {
      type: "rect",
      id: "bg",
      box: { x: 0, y: 0, w: widthMm, h: heightMm },
      fill: bgColor,
      decor: true,
    },
    {
      type: "rect",
      id: "band",
      box: toAbsolute([0, 0, 100, 100], headerSlot),
      fill: roleColor,
      decor: true,
    },
    {
      type: "rect",
      id: "logo1",
      box: toAbsolute([6, 15, 38, 70], headerSlot),
      fill: "#D1D5DB",
    },
    {
      type: "rect",
      id: "logo2",
      box: toAbsolute([56, 15, 38, 70], headerSlot),
      fill: "#D1D5DB",
    },
    {
      type: "rect",
      id: "photo",
      box: toAbsolute([0, 0, 100, 100], photoSlot),
      fill: "#E5E7EB",
      radius: 4,
    },
    {
      type: "text",
      id: "name",
      box: nameBox,
      lines: nameFit.lines,
      sizeMm: nameFit.sizeMm,
      font: headingFontFamily,
      fill: textColor,
      anchor: "middle",
      status: nameFit.status,
      bind: "person.name",
    },
    {
      type: "text",
      id: "role",
      box: roleBox,
      lines: roleFit.lines,
      sizeMm: roleFit.sizeMm,
      font: bodyFontFamily,
      fill: textColor,
      anchor: "middle",
      status: roleFit.status,
      bind: "role.label",
    },
    {
      type: "rect",
      id: "bar",
      box: toAbsolute([0, 0, 100, 100], markerSlot),
      fill: roleColor,
      decor: true,
    },
  ];

  // 7. Validate scene with context (D-21)
  const context = {
    card: input.card,
    brand: input.brand,
    font: fontObj,
    person: input.person,
    event: input.event,
    theme,
  };
  let issues = validate(scene, context);

  // 8. Autofix recoverable defects (Part 10 & 11.3, D-23)
  const autofixResult = autofix({
    ...input,
    scene,
    issues,
    font: fontObj,
    theme,
  });
  scene = autofixResult.scene;
  issues = autofixResult.issues;
  const fixes = autofixResult.fixes || [];

  // 9. Emit SVG strictly from the final (repaired) scene nodes
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

      if (node.lines.length === 1) {
        const y = node.box.y + (node.box.h - node.sizeMm) / 2 + node.sizeMm * 0.85;
        return `<text id="${node.id}" x="${x}" y="${y}" fill="${node.fill}" font-family="${escapeXml(node.font)}" font-size="${node.sizeMm}" text-anchor="${node.anchor}">${escapeXml(node.lines[0])}</text>`;
      }

      const lineHeightMm = node.sizeMm * LINE_HEIGHT;
      const totalHeight = (node.lines.length - 1) * lineHeightMm + node.sizeMm;
      const startY = node.box.y + (node.box.h - totalHeight) / 2 + node.sizeMm * 0.85;
      const tspans = node.lines
        .map((line, idx) => {
          const dy = idx === 0 ? 0 : lineHeightMm;
          return `<tspan x="${x}" dy="${dy}">${escapeXml(line)}</tspan>`;
        })
        .join("");
      return `<text id="${node.id}" x="${x}" y="${startY}" fill="${node.fill}" font-family="${escapeXml(node.font)}" font-size="${node.sizeMm}" text-anchor="${node.anchor}">${tspans}</text>`;
    }
    return "";
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}">${svgElements.join("")}</svg>`;

  return { svg, scene, issues, fixes };
}
