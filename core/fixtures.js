// @ts-check
/**
 * @module core/fixtures
 * Valid sample data for every schema. Used by tests and as reference
 * for Person B (server) and Person C (client).
 *
 * Fixtures follow the field names in Part 5 of the knowledge base exactly.
 */

// ═══════════════════════════════════════════════════════════════════════
//  EventSpec
// ═══════════════════════════════════════════════════════════════════════

/** @type {import("./schemas.js").EventSpec extends import("zod").ZodType<infer T> ? T : never} */
export const sampleEventSpec = {
  schemaVersion: 1,
  designType: "id-card",
  event: {
    name:    { value: "HackNUThon 2026", status: "provided", source: "brief", confirmed: true },
    tagline: { value: null, status: "declined" },
    venue:   { value: "SVNIT, Surat", status: "provided", source: "brief", confirmed: false },
    dates:   { value: ["2026-10-18"], status: "provided", source: "brief", confirmed: true },
  },
  roles: [
    {
      id: "participant", label: "PARTICIPANT", expectedCount: 200,
      color: { value: "#2563EB", status: "defaulted", source: "default" },
    },
    {
      id: "mentor", label: "MENTOR", expectedCount: 20,
      color: { value: "#16A34A", status: "defaulted", source: "default" },
    },
  ],
  fields: { value: ["name", "role", "id", "photo", "qr"], status: "provided", source: "answer" },
  card: {
    widthMm: 54, heightMm: 85.6, orientation: "portrait",
    bleedMm: 3, safeMarginMm: 3, sides: "front",
  },
  qr: { enabled: true, urlPattern: "https://example.org/checkin/{id}" },
};

// ═══════════════════════════════════════════════════════════════════════
//  Person (three variants)
// ═══════════════════════════════════════════════════════════════════════

/** Normal person – all fields present, no flags. */
export const personNormal = {
  id: "HX26-P-001",
  name: "Aarav Mehta",
  roleId: "participant",
  org: "SVNIT",
  email: "aarav@example.com",
  photo: "uploads/proj1/photos/HX26-P-001.jpg",
  checkinUrl: "https://example.org/checkin/HX26-P-001",
  flags: [],
};

/** Person with a very long name (57 chars) → LONG_NAME flag. */
export const personLongName = {
  id: "HX26-P-002",
  name: "Rajeshwari Venkatanarasimharajuvaripeta Chandrasekharaiah",
  roleId: "participant",
  org: "SVNIT",
  email: "rajeshwari@example.com",
  photo: "uploads/proj1/photos/HX26-P-002.jpg",
  checkinUrl: "https://example.org/checkin/HX26-P-002",
  flags: ["LONG_NAME"],
};

/** Person with no photo → NO_PHOTO flag, photo is null. */
export const personNoPhoto = {
  id: "HX26-M-001",
  name: "Priya Sharma",
  roleId: "mentor",
  org: "Google",
  email: "priya@example.com",
  photo: null,
  checkinUrl: "https://example.org/checkin/HX26-M-001",
  flags: ["NO_PHOTO"],
};

/** All three persons in an array for convenience. */
export const samplePersons = [personNormal, personLongName, personNoPhoto];

// ═══════════════════════════════════════════════════════════════════════
//  BrandKit
// ═══════════════════════════════════════════════════════════════════════

export const sampleBrandKit = {
  id: "acm-nitsurat",
  name: "ACM NIT Surat",
  logos: {
    primary:   { file: "acm-nitsurat.svg", minWidthMm: 12, clearSpaceMm: 2 },
    secondary: { file: "svnit.svg",        minWidthMm: 12, clearSpaceMm: 2 },
  },
  palette: { primary: "#0085FF", secondary: "#FF6B35", dark: "#111827", light: "#F9FAFB" },
  fonts:   { heading: "Inter", body: "Inter" },
  qrDefaultUrl: "https://example.org/checkin/{id}",
};

// ═══════════════════════════════════════════════════════════════════════
//  Skeleton
// ═══════════════════════════════════════════════════════════════════════

export const sampleSkeleton = {
  id: "portrait",
  size: { w: 54, h: 85.6 },
  slots: {
    header:     [0,  0,  54, 26],
    photo:      [13, 22, 28, 34],
    info:       [4,  58, 46, 18],
    roleMarker: [0,  78, 54, 7.6],
  },
  supports: { orientation: ["portrait"], photo: true, qr: true },
};

// ═══════════════════════════════════════════════════════════════════════
//  Block
// ═══════════════════════════════════════════════════════════════════════

export const sampleBlock = {
  id: "header.solid",
  slot: "header",
  elements: [
    { id: "band",  type: "rect",  box: [0, 0, 100, 100], fill: "$role.color" },
    { id: "logo1", type: "image", box: [6, 15, 38, 70],
      src: "$brand.logo.primary", fit: "contain", anchor: "left" },
    { id: "logo2", type: "image", box: [56, 15, 38, 70],
      src: "$brand.logo.secondary", fit: "contain", anchor: "right" },
  ],
};

// ═══════════════════════════════════════════════════════════════════════
//  Theme
// ═══════════════════════════════════════════════════════════════════════

export const sampleTheme = {
  id: "brand-blue",
  colors: { background: "#FFFFFF", text: "#111827", accent: "$brand.palette.primary" },
  fonts:  { heading: "$brand.fonts.heading", body: "$brand.fonts.body" },
};

// ═══════════════════════════════════════════════════════════════════════
//  Look
// ═══════════════════════════════════════════════════════════════════════

export const sampleLook = {
  id: "look.bold",
  skeleton: "portrait",
  theme: "brand-blue",
  blocks: {
    header:     "header.solid",
    photo:      "photo.rounded",
    info:       "info.centered",
    roleMarker: "marker.bottom-bar",
  },
  attributes: {
    skeleton: "portrait",
    header:   "solid",
    photo:    "rounded",
    marker:   "bottom-bar",
    theme:    "blue",
  },
  tags: ["bold", "tech", "energetic"],
  requires: { orientation: ["portrait"], maxRoles: 6, needsPhotoSlot: false },
};

// ═══════════════════════════════════════════════════════════════════════
//  SceneNode (one of each type)
// ═══════════════════════════════════════════════════════════════════════

export const sampleSceneNodes = {
  rect: {
    type: "rect", id: "band",
    box: { x: 0, y: 0, w: 54, h: 26 },
    fill: "#2563EB",
  },
  image: {
    type: "image", id: "logo1",
    box: { x: 3.24, y: 3.9, w: 20.52, h: 18.2 },
    href: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    srcW: 200, srcH: 150,
  },
  text: {
    type: "text", id: "name",
    box: { x: 4, y: 58, w: 46, h: 8 },
    lines: ["Aarav Mehta"],
    sizeMm: 3.17, font: "Inter", fill: "#111827",
    anchor: "middle", status: "ok",
  },
  path: {
    type: "path", id: "qr",
    box: { x: 20, y: 70, w: 15, h: 15 },
    d: "M0 0h1v1h-1z", fill: "#000000",
  },
};

// ═══════════════════════════════════════════════════════════════════════
//  Issue
// ═══════════════════════════════════════════════════════════════════════

export const sampleIssue = {
  severity: "warning",
  code: "TEXT_TRUNCATED",
  nodeId: "name",
  message: "Name was truncated to fit the available space",
};

// ═══════════════════════════════════════════════════════════════════════
//  DesignConfig
// ═══════════════════════════════════════════════════════════════════════

export const sampleDesignConfig = {
  lookId: "look.bold",
  themeId: "brand-blue",
  roleStyles: {
    mentor: { color: "#16A34A", marker: "corner-ribbon" },
  },
  overrides: {
    template: { logo1: { box: [4, 4, 20, 10] } },
    roles:    { mentor: { hide: ["pattern"] } },
    people:   { "HX26-P-014": { name: { minSizeMm: 1.6 } } },
  },
  seed: 1,
};

// ═══════════════════════════════════════════════════════════════════════
//  ExportSettings
// ═══════════════════════════════════════════════════════════════════════

export const sampleExportSettings = {
  format: "pdf",
  mode: "sheet",
  sheet: "A4",
  dpi: 300,
  bleedMm: 3,
  cropMarks: true,
  sides: "both",
  textAsOutlines: true,
  groupByRole: true,
};

// ═══════════════════════════════════════════════════════════════════════
//  Operation (sample of each type)
// ═══════════════════════════════════════════════════════════════════════

export const sampleOperations = [
  { op: "setDensity",      value: "airy" },
  { op: "setHeaderStyle",  value: "thin-line" },
  { op: "setPhotoShape",   value: "circle" },
  { op: "setRoleMarker",   value: "side-stripe" },
  { op: "setRoleMarker",   roleId: "mentor", value: "corner-ribbon" },
  { op: "setPattern",      value: "none" },
  { op: "setTheme",        value: "dark" },
  { op: "setAccentColor",  value: "#FF6B35" },
  { op: "setAccentColor",  roleId: "mentor", value: "#16A34A" },
  { op: "moveElement",     id: "logo1", slot: "header" },
  { op: "resizeElement",   id: "logo1", scale: 1.2 },
  { op: "hideElement",     id: "pattern" },
  { op: "showElement",     id: "pattern" },
  { op: "setTextOverride", personId: "HX26-P-001", field: "name", value: "A. Mehta" },
];
