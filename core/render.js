// @ts-check
import { autofix } from "./autofix.js";
import {
  defaultBlocks,
  defaultLook,
  defaultSkeleton,
  defaultTheme,
} from "./templateData.js";
import { fitText, PT_TO_MM } from "./text.js";
import { deriveTheme } from "./themeDerivation.js";
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
 * @returns {{ svg: string, scene: import("./schemas.js").SceneNode extends import("zod").ZodType<infer T> ? T[] : any[], issues: import("./schemas.js").Issue extends import("zod").ZodType<infer T> ? T[] : any[], fixes: Array<{ code: string, nodeId?: string, action: string }> }}
 */
export function renderCard(input) {
  const skeleton = input.skeleton || {
    id: "portrait",
    size: { w: 54, h: 85.6 },
    slots: {
      header: [0, 0, 54, 26],
      photo: [13, 22, 28, 34],
      info: [4, 58, 46, 18],
      roleMarker: [0, 78, 54, 7.6],
    },
  };

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

  // 2. Resolve or derive theme colors (D-24)
  const palette =
    input.palette ||
    input.event?.event?.palette?.value ||
    input.event?.event?.palette ||
    input.event?.palette ||
    input.brand?.palette;

  const look = input.look || {
    id: "look.bold",
    skeleton: "portrait",
    theme: "brand-blue",
    blocks: {
      header: "header.solid",
      photo: "photo.rounded",
      info: "info.centered",
      roleMarker: "marker.bottom-bar",
    },
    attributes: {
      skeleton: "portrait",
      header: "solid",
      photo: "rounded",
      marker: "bottom-bar",
      theme: "blue",
      mode: "colour-field",
      strategy: "role-led",
    },
  };

  let theme = input.theme;
  if (!theme && palette && look?.attributes?.mode) {
    theme = deriveTheme(
      Array.isArray(palette) ? palette : [palette.primary, palette.secondary],
      look.attributes.mode,
      look.attributes.strategy || "event-led"
    );
  } else if (!theme) {
    theme = defaultTheme || {
      colors: {
        background: "#FFFFFF",
        text: "#111827",
        accent: "$brand.palette.primary",
      },
      fonts: {
        heading: "$brand.fonts.heading",
        body: "$brand.fonts.body",
      },
    };
  }

  const bgColor = theme.colors.background === "$brand.palette.light"
    ? (brand?.palette?.light || "#FFFFFF")
    : (theme.colors.background || "#FFFFFF");

  const textColor = theme.colors.text === "$brand.palette.dark"
    ? (brand?.palette?.dark || "#111827")
    : (theme.colors.text || "#111827");

  const accentColor = theme.colors.accent === "$brand.palette.primary"
    ? (brand?.palette?.primary || "#0085FF")
    : (theme.colors.accent === "$brand.palette.secondary"
      ? (brand?.palette?.secondary || "#FF6B35")
      : (theme.colors.accent || "#0085FF"));

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

  // 4. Assemble scene graph (Part 10 pipeline)
  /** @type {any[]} */
  let scene = [
    {
      type: "rect",
      id: "bg",
      box: { x: 0, y: 0, w: widthMm, h: heightMm },
      fill: bgColor,
      decor: true,
    },
  ];

  const blocks = input.blocks || defaultBlocks || {};

  // Default fallback blocks if nothing passed
  const fallbackBlocks = {
    "header.solid": {
      elements: [
        { id: "band", type: "rect", box: [0, 0, 100, 100], fill: "$role.color", decor: true },
        { id: "logo1", type: "image", box: [6, 15, 38, 70], src: "$brand.logo.primary" },
        { id: "logo2", type: "image", box: [56, 15, 38, 70], src: "$brand.logo.secondary" },
      ],
    },
    "photo.rounded": {
      elements: [{ id: "photo", type: "image", box: [0, 0, 100, 100], src: "$person.photo", clip: "rounded" }],
    },
    "info.centered": {
      elements: [
        { id: "name", type: "text", bind: "person.name", font: "heading", box: [5, 10, 90, 50], size: [9, 6.5], oneLineFloor: 7.5, maxLines: 2, align: "center" },
        { id: "role", type: "text", bind: "role.label", font: "body", box: [5, 65, 90, 30], size: [6, 4], maxLines: 1, align: "center" },
      ],
    },
    "marker.bottom-bar": {
      elements: [{ id: "bar", type: "rect", box: [0, 0, 100, 100], fill: "$role.color", decor: true }],
    },
  };

  // Iterate over slots defined in skeleton
  for (const [slotName, slotBox] of Object.entries(skeleton.slots)) {
    const blockId = look?.blocks?.[slotName];
    const block = (blockId && blocks[blockId]) || (blockId && fallbackBlocks[blockId]) || defaultBlocks[blockId];
    if (!block || !Array.isArray(block.elements)) continue;

    for (const el of block.elements) {
      const box = toAbsolute(el.box, slotBox);

      if (el.type === "rect") {
        let fill = el.fill;
        if (fill === "$role.color") fill = roleColor;
        else if (fill === "$theme.colors.accent") fill = accentColor;
        else if (fill === "$theme.colors.text") fill = textColor;
        else if (fill === "$theme.colors.background") fill = bgColor;
        else if (fill === "$brand.palette.primary") fill = brand?.palette?.primary || "#0085FF";
        else if (fill === "$brand.palette.secondary") fill = brand?.palette?.secondary || "#FF6B35";

        const isDecor = el.decor ?? (el.id === "band" || el.id === "bar" || el.id === "stripe" || el.id === "ribbon" || el.id === "line");

        scene.push({
          type: "rect",
          id: el.id,
          box,
          fill,
          ...(el.radius ? { radius: el.radius } : {}),
          decor: isDecor,
          ...(el.optional ? { optional: el.optional } : {}),
        });
      } else if (el.type === "image") {
        if (el.src === "$person.photo") {
          const isCircle = el.clip === "circle";
          scene.push({
            type: "rect",
            id: el.id,
            box,
            fill: "#E5E7EB",
            radius: isCircle ? Math.min(box.w, box.h) / 2 : 4,
            ...(el.clip ? { clip: el.clip } : {}),
            ...(el.decor ? { decor: el.decor } : {}),
            ...(el.optional ? { optional: el.optional } : {}),
          });
        } else {
          // Logo element (logo1 or logo2)
          const logoKey = el.id === "logo1" ? "primary" : el.id === "logo2" ? "secondary" : null;
          const logoSpec = logoKey ? brand?.logos?.[logoKey] : null;

          if (logoSpec?.dataUri && logoSpec?.width && logoSpec?.height) {
            const srcW = logoSpec.width;
            const srcH = logoSpec.height;
            // Fit mode "contain": ONE scale for both axes (spec 10.4 & 10.5)
            const scale = Math.min(box.w / srcW, box.h / srcH);
            const fittedW = srcW * scale;
            const fittedH = srcH * scale;
            const anchor = el.anchor || "center";
            const fittedX =
              anchor === "left"
                ? box.x
                : anchor === "right"
                ? box.x + box.w - fittedW
                : box.x + (box.w - fittedW) / 2;
            const fittedY = box.y + (box.h - fittedH) / 2;

            scene.push({
              type: "image",
              id: el.id,
              box: { x: fittedX, y: fittedY, w: fittedW, h: fittedH },
              href: logoSpec.dataUri,
              srcW,
              srcH,
              ...(el.decor ? { decor: el.decor } : {}),
              ...(el.optional ? { optional: el.optional } : {}),
            });
          } else {
            // Logo placeholder
            scene.push({
              type: "rect",
              id: el.id,
              box,
              fill: "#D1D5DB",
              ...(el.decor ? { decor: el.decor } : {}),
              ...(el.optional ? { optional: el.optional } : {}),
            });
          }
        }
      } else if (el.type === "text") {
        let textVal = "";
        if (el.bind === "person.name") {
          textVal = person.name || "";
        } else if (el.bind === "role.label") {
          textVal = roleLabel;
        } else {
          textVal = person[el.bind] || "";
        }

        const isHeading = el.font === "heading" || el.bind === "person.name";
        const font = isHeading ? fontObj : bodyFontObj;
        const fontFamily = isHeading ? headingFontFamily : bodyFontFamily;

        let fit;
        if (font) {
          fit = fitText({
            text: textVal,
            boxWidthMm: box.w,
            boxHeightMm: box.h,
            sizeRangePt: el.size,
            oneLineFloorPt: el.oneLineFloor,
            maxLines: el.maxLines || 2,
            font,
          });
        } else {
          fit = {
            lines: [textVal],
            sizeMm: el.size[0] * PT_TO_MM,
            status: "ok",
          };
        }

        const anchor = el.align === "left" ? "start" : el.align === "right" ? "end" : "middle";
        let fill = textColor;
        if (el.fill === "$theme.colors.accent") fill = accentColor;
        else if (el.fill && !el.fill.startsWith("$")) fill = el.fill;

        scene.push({
          type: "text",
          id: el.id,
          box,
          lines: fit.lines,
          sizeMm: fit.sizeMm,
          font: fontFamily,
          fill,
          anchor,
          status: fit.status,
          bind: el.bind,
          ...(el.decor ? { decor: el.decor } : {}),
          ...(el.optional ? { optional: el.optional } : {}),
        });
      }
    }
  }

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
    if (node.type === "image") {
      return `<image id="${node.id}" x="${node.box.x}" y="${node.box.y}" width="${node.box.w}" height="${node.box.h}" href="${escapeXml(node.href)}"/>`;
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
