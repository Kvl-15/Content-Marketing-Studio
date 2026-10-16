// @ts-check
/**
 * @module core/render
 */

/**
 * Render an ID card into an SVG, scene graph, and issue list.
 *
 * STUB: replace with real implementation
 *
 * @param {Record<string, any>} input
 * @returns {{ svg: string, scene: import("./schemas.js").SceneNode extends import("zod").ZodType<infer T> ? T[] : any[], issues: import("./schemas.js").Issue extends import("zod").ZodType<infer T> ? T[] : any[] }}
 */
export function renderCard(input) {
  const orientation = input.card?.orientation || "portrait";
  const isLandscape = orientation === "landscape";
  const widthMm = input.card?.widthMm ?? (isLandscape ? 85.6 : 54);
  const heightMm = input.card?.heightMm ?? (isLandscape ? 54 : 85.6);
  const name = input.person?.name || "Participant";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}"><rect width="${widthMm}" height="${heightMm}" fill="#F3F4F6" stroke="#374151" stroke-width="0.3"/><text x="${widthMm / 2}" y="${heightMm / 2}" text-anchor="middle" font-family="sans-serif" font-size="4">${name}</text></svg>`;

  /** @type {any[]} */
  const scene = [
    {
      type: "rect",
      id: "bg",
      box: { x: 0, y: 0, w: widthMm, h: heightMm },
      fill: "#F3F4F6",
    },
    {
      type: "text",
      id: "name",
      box: { x: 0, y: heightMm / 2 - 2, w: widthMm, h: 4 },
      lines: [name],
      sizeMm: 4,
      font: "sans-serif",
      fill: "#000000",
      anchor: "middle",
      status: "ok",
    },
  ];

  /** @type {any[]} */
  const issues = [];

  return { svg, scene, issues };
}
