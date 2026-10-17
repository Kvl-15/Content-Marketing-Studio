// @ts-check
/**
 * @module core/templateData
 * Pure JSON-compatible template definitions for the default look.
 * Conforms to Skeleton, Block, Theme, and Look schemas (Part 5.4).
 */

/** @type {import("./schemas.js").Skeleton extends import("zod").ZodType<infer T> ? T : any} */
export const defaultSkeleton = {
  id: "portrait",
  size: { w: 54, h: 85.6 },
  slots: {
    header:     [0, 0, 54, 26],
    photo:      [13, 22, 28, 34],
    info:       [4, 58, 46, 18],
    roleMarker: [0, 78, 54, 7.6],
  },
  supports: {
    orientation: ["portrait"],
    photo: true,
    qr: true,
  },
};

/** @type {Record<string, import("./schemas.js").Block extends import("zod").ZodType<infer T> ? T : any>} */
export const defaultBlocks = {
  "header.solid": {
    id: "header.solid",
    slot: "header",
    elements: [
      { id: "band", type: "rect", box: [0, 0, 100, 100], fill: "$role.color", decor: true },
      { id: "logo1", type: "image", src: "$brand.logo.primary", box: [6, 15, 38, 70], fit: "contain", anchor: "left" },
      { id: "logo2", type: "image", src: "$brand.logo.secondary", box: [56, 15, 38, 70], fit: "contain", anchor: "right" },
    ],
  },
  "photo.rounded": {
    id: "photo.rounded",
    slot: "photo",
    elements: [
      { id: "photo", type: "image", src: "$person.photo", box: [0, 0, 100, 100], fit: "cover" },
    ],
  },
  "info.centered": {
    id: "info.centered",
    slot: "info",
    elements: [
      { id: "name", type: "text", bind: "person.name", font: "heading", box: [5, 10, 90, 50], size: [9, 6.5], oneLineFloor: 7.5, maxLines: 2, align: "center" },
      { id: "role", type: "text", bind: "role.label", font: "body", box: [5, 65, 90, 30], size: [6, 4], maxLines: 1, align: "center" },
    ],
  },
  "marker.bottom-bar": {
    id: "marker.bottom-bar",
    slot: "roleMarker",
    elements: [
      { id: "bar", type: "rect", box: [0, 0, 100, 100], fill: "$role.color", decor: true },
    ],
  },
};

/** @type {import("./schemas.js").Theme extends import("zod").ZodType<infer T> ? T : any} */
export const defaultTheme = {
  id: "brand-blue",
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

/** @type {import("./schemas.js").Look extends import("zod").ZodType<infer T> ? T : any} */
export const defaultLook = {
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
  },
  tags: ["bold", "tech", "energetic"],
  requires: {
    orientation: ["portrait"],
    maxRoles: 6,
    needsPhotoSlot: false,
  },
};
