// @ts-check
import { autofix } from "./autofix.js";
import {
  defaultBlocks,
  defaultLook,
  defaultSkeleton,
  defaultTheme,
} from "./templateData.js";
import { fitText, measure, PT_TO_MM, textToPathData } from "./text.js";
import { deriveTheme, ensureContrast } from "./themeDerivation.js";
import { contrastRatio, LINE_HEIGHT, relativeLuminance, validate } from "./validate.js";

/**
 * @module core/render
 */

/**
 * Calculates HSL lightness from a 6-digit hex string.
 *
 * @param {string} hex
 * @returns {number}
 */
function getLightness(hex) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#") || hex.length !== 7) return 1;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return (max + min) / 2;
}

/**
 * Finds the background color behind a bounding box.
 *
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @param {any[]} scene
 * @param {string} fallbackBg
 * @param {string} [excludeId]
 * @returns {string}
 */
function findBackgroundBehindBox(box, scene, fallbackBg, excludeId) {
  const decorRects = scene.filter(
    (n) =>
      n.type === "rect" &&
      n.decor === true &&
      (!excludeId || n.id !== excludeId) &&
      n.box.x <= box.x + box.w / 2 &&
      n.box.x + n.box.w >= box.x + box.w / 2 &&
      n.box.y <= box.y + box.h / 2 &&
      n.box.y + n.box.h >= box.y + box.h / 2
  );
  if (decorRects.length > 0) {
    return decorRects[decorRects.length - 1].fill;
  }
  return fallbackBg || "#FFFFFF";
}

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

  // 1. Resolve role details from event (D-09: No fabricated fallbacks)
  const roleMatch = event?.roles?.find((/** @type {any} */ r) => r.id === person.roleId);
  const roleLabel = roleMatch ? roleMatch.label : "UNKNOWN ROLE";
  const roleColor = roleMatch?.color?.value || "#6B7280";

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
  const preflightIssues = [];
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
        { id: "logo1", type: "image", box: [6, 15, 38, 70], src: "$brand.logo.primary", plate: "auto" },
        { id: "logo2", type: "image", box: [56, 15, 38, 70], src: "$brand.logo.secondary", plate: "auto" },
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

  const qrEnabled = event?.qr?.enabled ?? event?.event?.qr?.enabled ?? true;

  // Iterate over slots defined in skeleton
  for (const [slotName, slotBox] of Object.entries(skeleton.slots)) {
    const blockId = look?.blocks?.[slotName];
    const block = (blockId && blocks[blockId]) || (blockId && fallbackBlocks[blockId]) || defaultBlocks[blockId];
    if (!block || !Array.isArray(block.elements)) continue;

    let elements = block.elements;
    // When QR is disabled in the spec: no QR element and no warning
    if (!qrEnabled) {
      elements = elements.filter((e) => e.id !== "qr-box" && e.id !== "qr-label" && e.bind !== "qr");
    }

    // Dynamic drop handling for bottom stack when space is constrained (drop order: QR -> org -> id-line)
    if (slotName === "info" || slotName === "meta") {
      const hasQr = elements.some((e) => e.id === "qr-box" || e.bind === "qr" || e.id === "qr-label");
      const hasOrg = elements.some((e) => e.id === "org" || e.bind === "person.org" || e.bind === "org");
      const hasId = elements.some((e) => e.id === "id-line" || e.bind === "person.id" || e.bind === "id");

      const availableH = slotBox[3];
      if (hasQr && availableH < 21.0) {
        elements = elements.filter((e) => e.id !== "qr-box" && e.id !== "qr-label" && e.bind !== "qr");
        if (qrEnabled) {
          preflightIssues.push({
            code: "ELEMENT_DROPPED",
            severity: "warning",
            nodeId: "qr",
            message: `Element 'qr' dropped on card for person '${person.id || person.name || "unknown"}' to maintain >= 2 mm spacing floor`,
          });
        }
      }
      if (hasOrg && availableH < 17.0) {
        elements = elements.filter((e) => e.id !== "org" && e.bind !== "person.org" && e.bind !== "org");
        preflightIssues.push({
          code: "ELEMENT_DROPPED",
          severity: "warning",
          nodeId: "org",
          message: `Element 'org' dropped on card for person '${person.id || person.name || "unknown"}' to maintain >= 2 mm spacing floor`,
        });
      }
      if (hasId && availableH < 13.0) {
        elements = elements.filter((e) => e.id !== "id-line" && e.bind !== "person.id" && e.bind !== "id");
        preflightIssues.push({
          code: "ELEMENT_DROPPED",
          severity: "warning",
          nodeId: "id-line",
          message: `Element 'id-line' dropped on card for person '${person.id || person.name || "unknown"}' to maintain >= 2 mm spacing floor`,
        });
      }
    }

    for (const el of elements) {
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
          const radius = isCircle ? Math.min(box.w, box.h) / 2 : 4;
          const isDataUri = typeof person.photo === "string" && person.photo.startsWith("data:");

          if (isDataUri) {
            scene.push({
              type: "image",
              id: el.id,
              box,
              href: person.photo,
              srcW: 500,
              srcH: 500,
              ...(el.clip ? { clip: el.clip } : {}),
              ...(el.decor ? { decor: el.decor } : {}),
              ...(el.optional ? { optional: el.optional } : {}),
            });
          } else {
            const hasPhotoField = typeof person.photo === "string" && person.photo.trim().length > 0;
            if (hasPhotoField) {
              scene.push({
                type: "rect",
                id: el.id,
                box,
                fill: "#E2E8F0",
                radius,
                clip: isCircle ? "circle" : "rounded",
                photoMode: "silhouette",
                ...(el.decor ? { decor: el.decor } : {}),
                ...(el.optional ? { optional: el.optional } : {}),
              });
            } else {
              let initials = "";
              if (person.name) {
                const parts = person.name.trim().split(/\s+/).filter(Boolean);
                if (parts.length === 1) {
                  initials = parts[0][0].toUpperCase();
                } else if (parts.length > 1) {
                  initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
                }
              }
              if (!initials) initials = "?";

              scene.push({
                type: "rect",
                id: el.id,
                box,
                fill: "#E5E7EB",
                radius,
                clip: isCircle ? "circle" : "rounded",
                photoMode: "initials",
                initials,
                ...(el.decor ? { decor: el.decor } : {}),
                ...(el.optional ? { optional: el.optional } : {}),
              });
            }
          }
        } else {
          // Logo element (logo1 or logo2)
          const logoKey = el.id === "logo1" ? "primary" : el.id === "logo2" ? "secondary" : null;
          const logoSpec = logoKey ? brand?.logos?.[logoKey] : null;

          let targetBox = box;
          let fittedW = box.w;
          let fittedH = box.h;
          let fittedX = box.x;
          let fittedY = box.y;
          const hasRealLogo = !!(logoSpec?.dataUri && logoSpec?.width && logoSpec?.height);

          if (hasRealLogo) {
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
            targetBox = { x: fittedX, y: fittedY, w: fittedW, h: fittedH };
          }

          if (el.plate) {
            let shouldDraw = false;
            let plateFill = "#FFFFFF";
            let plateRadius = 1;
            let platePadding = 1;

            if (el.plate === "shared") {
              const sharedSiblings = block.elements.filter(
                (/** @type {any} */ e) => e.type === "image" && (e.id === "logo1" || e.id === "logo2" || e.id.startsWith("logo")) && e.plate === "shared"
              );
              if (sharedSiblings.length > 0) {
                const isFirstLogo = el.id === sharedSiblings[0].id;
                if (isFirstLogo) {
                  const slotBoxes = sharedSiblings.map((/** @type {any} */ s) => {
                    return toAbsolute(s.box, slotBox);
                  });
                  const minX = Math.min(...slotBoxes.map((b) => b.x));
                  const minY = Math.min(...slotBoxes.map((b) => b.y));
                  const maxX = Math.max(...slotBoxes.map((b) => b.x + b.w));
                  const maxY = Math.max(...slotBoxes.map((b) => b.y + b.h));

                  const sharedBox = {
                    x: Math.round((minX - 1.0) * 100) / 100,
                    y: Math.round((minY - 1.0) * 100) / 100,
                    w: Math.round((maxX - minX + 2.0) * 100) / 100,
                    h: Math.round((maxY - minY + 2.0) * 100) / 100,
                  };

                  const bgBehind = findBackgroundBehindBox(sharedBox, scene, bgColor);
                  const isDarkOrSaturated = relativeLuminance(bgBehind) < 0.88 || getLightness(bgBehind) < 0.88;

                  if (isDarkOrSaturated) {
                    scene.push({
                      type: "rect",
                      id: "logos-plate",
                      box: sharedBox,
                      fill: "#FFFFFF",
                      radius: 1.5,
                      decor: true,
                    });
                  }
                }
              }
            } else if (el.plate === "auto") {
              const bgBehind = findBackgroundBehindBox(box, scene, bgColor);
              const isDarkOrSaturated = relativeLuminance(bgBehind) < 0.9 || getLightness(bgBehind) < 0.9;
              if (isDarkOrSaturated) {
                shouldDraw = true;
                plateFill = "#FFFFFF";
                plateRadius = 1;
                platePadding = 1;
              }
            } else if (typeof el.plate === "object" && el.plate !== null) {
              shouldDraw = true;
              plateFill = el.plate.fill || "#FFFFFF";
              plateRadius = typeof el.plate.radiusMm === "number" ? el.plate.radiusMm : 1;
              platePadding = typeof el.plate.paddingMm === "number" ? el.plate.paddingMm : 1;
            }

            if (shouldDraw) {
              scene.push({
                type: "rect",
                id: `${el.id}-plate`,
                box: {
                  x: targetBox.x - platePadding,
                  y: targetBox.y - platePadding,
                  w: targetBox.w + platePadding * 2,
                  h: targetBox.h + platePadding * 2,
                },
                fill: plateFill,
                radius: plateRadius,
                decor: true,
              });
            }
          }

          if (hasRealLogo) {
            scene.push({
              type: "image",
              id: el.id,
              box: targetBox,
              href: logoSpec.dataUri,
              srcW: logoSpec.width,
              srcH: logoSpec.height,
              ...(el.plate ? { plate: el.plate } : {}),
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
              ...(el.plate ? { plate: el.plate } : {}),
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
        } else if (el.bind === "event.name") {
          const rawEvName = event?.event?.name?.value ?? event?.event?.name ?? event?.name?.value ?? event?.name;
          textVal = typeof rawEvName === "string" ? rawEvName.trim() : "";
        } else if (el.bind === "qr" || el.id === "qr-label") {
          textVal = "QR";
        } else if (el.bind === "person.org" || el.bind === "org") {
          textVal = person.org || "";
        } else if (el.bind === "person.id" || el.bind === "id") {
          textVal = person.id || "";
        } else {
          textVal = person[el.bind] || "";
        }

        if (!textVal && el.optional) {
          continue;
        }

        const isHeading = el.font === "heading" || el.bind === "person.name";
        const font = isHeading ? fontObj : bodyFontObj;
        const fontFamily = isHeading ? headingFontFamily : bodyFontFamily;
        const isEventName = el.bind === "event.name";

        let fit;
        if (font) {
          const sizeRange = isEventName ? [el.size?.[0] || 7, Math.min(el.size?.[1] || 6, 6)] : el.size;
          const maxLines = isEventName ? 2 : (el.maxLines || 2);
          const fittedText = isEventName ? textVal.toUpperCase() : textVal;

          fit = fitText({
            text: fittedText,
            boxWidthMm: box.w,
            boxHeightMm: box.h,
            sizeRangePt: sizeRange,
            oneLineFloorPt: el.oneLineFloor,
            maxLines,
            font,
          });

          if (isEventName && fit.status === "truncated") {
            // Event name is never truncated. If it cannot fit at 6 pt floor across 2 lines,
            // hide it and raise a warning issue EVENT_NAME_DOES_NOT_FIT.
            preflightIssues.push({
              code: "EVENT_NAME_DOES_NOT_FIT",
              message: `Event name "${textVal}" does not fit in available space at 6 pt floor; hidden`,
              severity: "warning",
              nodeId: el.id,
            });
            continue;
          }
        } else {
          fit = {
            lines: [isEventName ? textVal.toUpperCase() : textVal],
            sizeMm: el.size[0] * PT_TO_MM,
            status: "ok",
          };
        }

        const anchor = el.align === "left" ? "start" : el.align === "right" ? "end" : "middle";
        let fill = textColor;
        if (el.fill === "$theme.colors.accent") fill = accentColor;
        else if (el.fill === "$role.contrast") fill = contrastRatio("#FFFFFF", roleColor) >= 4.5 ? "#FFFFFF" : "#111827";
        else if (el.fill === "$theme.colors.text") fill = textColor;
        else if (el.fill === "$theme.colors.background") fill = bgColor;
        else if (el.fill && !el.fill.startsWith("$")) fill = el.fill;

        if (isEventName) {
          const bgBehind = findBackgroundBehindBox(box, scene, bgColor);
          fill = ensureContrast(fill, bgBehind, 4.5);
        }

        scene.push({
          type: "text",
          id: el.id,
          box,
          lines: fit.lines,
          sizeMm: fit.sizeMm,
          font: fontFamily,
          fontRole: isHeading ? "heading" : "body",
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

  // Role pill contrast check & repair (Rule C2c: prefer 0.6mm outline; use inversion only if outline fails)
  /** @type {any[]} */
  const localFixes = [];
  for (const node of scene) {
    if (node.type === "rect" && (node.id === "role-pill" || node.id === "pill")) {
      const bgBehind = findBackgroundBehindBox(node.box, scene, bgColor, node.id);
      const cr = contrastRatio(node.fill, bgBehind);
      if (cr < 3.0) {
        const outlineColor = (relativeLuminance(bgBehind) < 0.5 || getLightness(bgBehind) < 0.5) ? "#FFFFFF" : "#111827";
        if (contrastRatio(outlineColor, bgBehind) >= 3.0) {
          node.stroke = outlineColor;
          node.strokeWidth = 0.6;
          localFixes.push({
            code: "ROLE_PILL_OUTLINE",
            nodeId: node.id,
            stroke: outlineColor,
            strokeWidth: 0.6,
            reason: `Role pill contrast against background (${cr.toFixed(2)}) was < 3.0; added 0.6mm outline`,
          });
        } else {
          const adjustedFill = ensureContrast(node.fill, bgBehind, 3.0);
          localFixes.push({
            code: "ROLE_PILL_INVERT",
            nodeId: node.id,
            fill: adjustedFill,
            reason: `Role pill outline failed; adjusted fill to achieve >= 3.0 contrast`,
          });
          node.fill = adjustedFill;
        }
      }
    }
  }

  // 7. Validate scene with context (D-21)
  const context = {
    card: input.card,
    brand: input.brand,
    font: fontObj,
    fonts: input.fonts || (fontObj ? { heading: fontObj, body: bodyFontObj } : undefined),
    person: input.person,
    event: input.event,
    theme,
  };
  let issues = [...preflightIssues, ...validate(scene, context)];

  // 8. Autofix recoverable defects (Part 10 & 11.3, D-23)
  const autofixResult = autofix({
    ...input,
    scene,
    issues,
    font: fontObj,
    theme,
  });
  scene = autofixResult.scene;
  issues = [...preflightIssues, ...(autofixResult.issues || [])];
  const fixes = [...localFixes, ...(autofixResult.fixes || [])];

  // 9. Emit SVG strictly from the final (repaired) scene nodes
  const svgElements = scene.map((node) => {
    if (node.type === "rect") {
      if (node.photoMode === "silhouette") {
        const clipId = `clip-${node.id}`;
        const radius = node.radius ?? 4;
        const isCircle = node.clip === "circle";
        const clipShape = isCircle
          ? `<circle cx="${node.box.x + node.box.w / 2}" cy="${node.box.y + node.box.h / 2}" r="${Math.min(node.box.w, node.box.h) / 2}"/>`
          : `<rect x="${node.box.x}" y="${node.box.y}" width="${node.box.w}" height="${node.box.h}" rx="${radius}" ry="${radius}"/>`;

        const cx = node.box.x + node.box.w / 2;
        const headR = Math.min(node.box.w, node.box.h) * 0.22;
        const headCy = node.box.y + node.box.h * 0.38;
        const shoulderTopY = node.box.y + node.box.h * 0.68;
        const bottomY = node.box.y + node.box.h + 0.1;
        const leftX = node.box.x + node.box.w * 0.12;
        const rightX = node.box.x + node.box.w * 0.88;
        const shoulderPath = `M ${leftX} ${bottomY} C ${leftX} ${shoulderTopY}, ${rightX} ${shoulderTopY}, ${rightX} ${bottomY} Z`;

        return `<g id="${node.id}"><clipPath id="${clipId}">${clipShape}</clipPath><g clip-path="url(#${clipId})"><rect x="${node.box.x}" y="${node.box.y}" width="${node.box.w}" height="${node.box.h}" fill="${node.fill}"/><circle cx="${cx}" cy="${headCy}" r="${headR}" fill="#94A3B8"/><path d="${shoulderPath}" fill="#94A3B8"/></g></g>`;
      }

      if (node.photoMode === "initials") {
        const radiusAttr = node.radius ? ` rx="${node.radius}" ry="${node.radius}"` : "";
        const bgRect = `<rect x="${node.box.x}" y="${node.box.y}" width="${node.box.w}" height="${node.box.h}" fill="${node.fill}"${radiusAttr}/>`;

        const initSizeMm = Math.min(node.box.w, node.box.h) * 0.36;
        const initWidth = fontObj ? measure(node.initials || "?", initSizeMm, fontObj) : 0;
        const initX = node.box.x + (node.box.w - initWidth) / 2;
        const initY = node.box.y + (node.box.h - initSizeMm) / 2 + initSizeMm * 0.82;
        const initPath = fontObj ? textToPathData(node.initials || "?", initX, initY, initSizeMm, fontObj) : "";
        const textOutline = initPath ? `<path d="${initPath}" fill="#475569"/>` : "";

        return `<g id="${node.id}">${bgRect}${textOutline}</g>`;
      }

      const radiusAttr = node.radius ? ` rx="${node.radius}" ry="${node.radius}"` : "";
      const strokeAttr = node.stroke ? ` stroke="${node.stroke}" stroke-width="${node.strokeWidth || 0.6}"` : "";
      return `<rect id="${node.id}" x="${node.box.x}" y="${node.box.y}" width="${node.box.w}" height="${node.box.h}" fill="${node.fill}"${radiusAttr}${strokeAttr}/>`;
    }
    if (node.type === "image") {
      if (node.clip === "circle") {
        const clipId = `clip-${node.id}`;
        const cx = (node.box.x + node.box.w / 2).toFixed(3);
        const cy = (node.box.y + node.box.h / 2).toFixed(3);
        const r = (Math.min(node.box.w, node.box.h) / 2).toFixed(3);
        return `<g id="${node.id}"><clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><image clip-path="url(#${clipId})" x="${node.box.x}" y="${node.box.y}" width="${node.box.w}" height="${node.box.h}" href="${escapeXml(node.href)}"/></g>`;
      }
      if (node.clip === "rounded") {
        const clipId = `clip-${node.id}`;
        const rx = 3;
        return `<g id="${node.id}"><clipPath id="${clipId}"><rect x="${node.box.x}" y="${node.box.y}" width="${node.box.w}" height="${node.box.h}" rx="${rx}" ry="${rx}"/></clipPath><image clip-path="url(#${clipId})" x="${node.box.x}" y="${node.box.y}" width="${node.box.w}" height="${node.box.h}" href="${escapeXml(node.href)}"/></g>`;
      }
      return `<image id="${node.id}" x="${node.box.x}" y="${node.box.y}" width="${node.box.w}" height="${node.box.h}" href="${escapeXml(node.href)}"/>`;
    }
    if (node.type === "text") {
      const isHeading = node.fontRole === "heading" || node.bind === "person.name" || node.id === "name";
      const font = (isHeading ? fontObj : bodyFontObj) || fontObj;

      const pathDataList = [];
      const lineHeightMm = node.sizeMm * LINE_HEIGHT;
      const totalHeight = (node.lines.length - 1) * lineHeightMm + node.sizeMm;
      const startY = node.box.y + (node.box.h - totalHeight) / 2 + node.sizeMm * 0.85;

      for (let i = 0; i < node.lines.length; i++) {
        const line = node.lines[i];
        const lineWidth = font ? measure(line, node.sizeMm, font) : 0;
        let lineX = node.box.x;
        if (node.anchor === "middle") {
          lineX = node.box.x + (node.box.w - lineWidth) / 2;
        } else if (node.anchor === "end") {
          lineX = node.box.x + node.box.w - lineWidth;
        }
        const lineY = startY + i * lineHeightMm;
        const pData = font ? textToPathData(line, lineX, lineY, node.sizeMm, font) : "";
        if (pData) {
          pathDataList.push(pData);
        }
      }

      const combinedPath = pathDataList.join(" ");
      const ariaLabel = escapeXml(node.lines.join(" "));
      const pathTag = combinedPath ? `<path d="${combinedPath}" fill="${node.fill}"/>` : "";
      return `<g id="${node.id}" aria-label="${ariaLabel}">${pathTag}</g>`;
    }
    if (node.type === "path") {
      return `<path id="${node.id}" d="${node.d}" fill="${node.fill}"/>`;
    }
    return "";
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}">${svgElements.join("")}</svg>`;

  return { svg, scene, issues, fixes };
}
