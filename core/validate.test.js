// @ts-check
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import {
  checkLogoClearspace,
  checkLogoDistorted,
  checkLogoMissing,
  checkLogoTooSmall,
  checkLowContrast,
  checkNoPhoto,
  checkOutsideSafeMargin,
  checkOverlap,
  checkQrTooSmall,
  checkTextOverflow,
  checkTextTruncated,
  checkUnconfirmedValue,
  checkUnfilledData,
  LINE_HEIGHT,
  validate,
} from "./validate.js";
import { renderCard } from "./render.js";
import {
  personLongName,
  personNoPhoto,
  personNormal,
  sampleBrandKit,
  sampleEventSpec,
} from "./fixtures.js";
import { Issue } from "./schemas.js";

// Load test font from assets/fonts
const fontPath = resolve(process.cwd(), "assets/fonts/Roboto-VariableFont_wdth,wght.ttf");
const fontBuf = readFileSync(fontPath);
const testFont = opentype.parse(
  fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength)
);

describe("core/validate", () => {
  // 1. Signature & Graceful Fallback
  describe("Signature & Fallback", () => {
    it("runs validate(scene) with 1 argument without crashing", () => {
      const syntheticScene = [
        {
          type: "rect",
          id: "box1",
          box: { x: 5, y: 5, w: 20, h: 20 },
          fill: "#000000",
          decor: false,
        },
      ];
      expect(() => validate(syntheticScene)).not.toThrow();
      const issues = validate(syntheticScene);
      expect(Array.isArray(issues)).toBe(true);
      for (const issue of issues) {
        expect(() => Issue.parse(issue)).not.toThrow();
      }
    });

    it("returns empty issues array on empty or non-array scene", () => {
      expect(validate([])).toEqual([]);
      // @ts-ignore
      expect(validate(null)).toEqual([]);
    });

    it("exports LINE_HEIGHT constant of 1.25", () => {
      expect(LINE_HEIGHT).toBe(1.25);
    });
  });

  // 2. TEXT_TRUNCATED (Warning)
  describe("checkTextTruncated", () => {
    it("passes when text node status is ok", () => {
      const scene = [
        {
          type: "text",
          id: "name",
          box: { x: 5, y: 5, w: 40, h: 10 },
          lines: ["Preet Patel"],
          sizeMm: 3,
          font: "Inter",
          fill: "#000000",
          anchor: "middle",
          status: "ok",
        },
      ];
      const issues = checkTextTruncated(scene);
      expect(issues).toHaveLength(0);
    });

    it("fails with warning when text node status is truncated", () => {
      const scene = [
        {
          type: "text",
          id: "name",
          box: { x: 5, y: 5, w: 40, h: 10 },
          lines: ["Very Long Name..."],
          sizeMm: 3,
          font: "Inter",
          fill: "#000000",
          anchor: "middle",
          status: "truncated",
        },
      ];
      const issues = checkTextTruncated(scene);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("warning");
      expect(issues[0].code).toBe("TEXT_TRUNCATED");
      expect(issues[0].nodeId).toBe("name");
    });
  });

  // 3. TEXT_OVERFLOW (Error)
  describe("checkTextOverflow", () => {
    it("passes when text fits inside bounding box", () => {
      const scene = [
        {
          type: "text",
          id: "name",
          box: { x: 5, y: 5, w: 40, h: 10 },
          lines: ["Short Name"],
          sizeMm: 3,
          font: "Inter",
          fill: "#000000",
          anchor: "middle",
          status: "ok",
        },
      ];
      const issues = checkTextOverflow(scene, testFont);
      expect(issues).toHaveLength(0);
    });

    it("fails when text line exceeds box width", () => {
      const scene = [
        {
          type: "text",
          id: "name",
          box: { x: 5, y: 5, w: 10, h: 10 }, // box width only 10mm
          lines: ["Extremely Long Text Exceeding Box"],
          sizeMm: 4,
          font: "Inter",
          fill: "#000000",
          anchor: "middle",
          status: "ok",
        },
      ];
      const issues = checkTextOverflow(scene, testFont);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("error");
      expect(issues[0].code).toBe("TEXT_OVERFLOW");
      expect(issues[0].nodeId).toBe("name");
    });

    it("skips check gracefully if font is missing", () => {
      const scene = [
        {
          type: "text",
          id: "name",
          box: { x: 5, y: 5, w: 5, h: 5 },
          lines: ["Overflowing Text"],
          sizeMm: 5,
          font: "Inter",
          fill: "#000000",
          anchor: "middle",
          status: "ok",
        },
      ];
      expect(checkTextOverflow(scene, null)).toEqual([]);
    });
  });

  // 4. OVERLAP (Error)
  describe("checkOverlap", () => {
    it("passes when content elements do not intersect", () => {
      const scene = [
        {
          type: "rect",
          id: "boxA",
          box: { x: 5, y: 5, w: 10, h: 10 },
          fill: "#000000",
          decor: false,
        },
        {
          type: "rect",
          id: "boxB",
          box: { x: 20, y: 5, w: 10, h: 10 },
          fill: "#000000",
          decor: false,
        },
      ];
      const issues = checkOverlap(scene);
      expect(issues).toHaveLength(0);
    });

    it("fails when two content elements intersect", () => {
      const scene = [
        {
          type: "rect",
          id: "boxA",
          box: { x: 5, y: 5, w: 15, h: 15 },
          fill: "#000000",
          decor: false,
        },
        {
          type: "rect",
          id: "boxB",
          box: { x: 10, y: 10, w: 15, h: 15 },
          fill: "#000000",
          decor: false,
        },
      ];
      const issues = checkOverlap(scene);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("error");
      expect(issues[0].code).toBe("OVERLAP");
    });

    it("ignores overlap with decorative elements (decor: true)", () => {
      const scene = [
        {
          type: "rect",
          id: "bg",
          box: { x: 0, y: 0, w: 54, h: 85.6 },
          fill: "#FFFFFF",
          decor: true,
        },
        {
          type: "rect",
          id: "boxA",
          box: { x: 5, y: 5, w: 20, h: 20 },
          fill: "#000000",
          decor: false,
        },
      ];
      const issues = checkOverlap(scene);
      expect(issues).toHaveLength(0);
    });
  });

  // 5. OUTSIDE_SAFE_MARGIN (Error)
  describe("checkOutsideSafeMargin", () => {
    const card = { widthMm: 54, heightMm: 85.6, safeMarginMm: 3 };

    it("passes when content element is within safe margins", () => {
      const scene = [
        {
          type: "rect",
          id: "boxA",
          box: { x: 4, y: 4, w: 46, h: 20 },
          fill: "#000000",
          decor: false,
        },
      ];
      const issues = checkOutsideSafeMargin(scene, card);
      expect(issues).toHaveLength(0);
    });

    it("fails when content element violates left or top safe margin", () => {
      const scene = [
        {
          type: "rect",
          id: "boxA",
          box: { x: 1, y: 4, w: 20, h: 20 }, // x < 3mm margin
          fill: "#000000",
          decor: false,
        },
      ];
      const issues = checkOutsideSafeMargin(scene, card);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("error");
      expect(issues[0].code).toBe("OUTSIDE_SAFE_MARGIN");
      expect(issues[0].nodeId).toBe("boxA");
    });

    it("skips check gracefully if safeMarginMm is missing from context", () => {
      const scene = [
        {
          type: "rect",
          id: "boxA",
          box: { x: 0, y: 0, w: 20, h: 20 },
          fill: "#000000",
          decor: false,
        },
      ];
      expect(checkOutsideSafeMargin(scene, { widthMm: 54, heightMm: 85.6 })).toEqual([]);
      expect(checkOutsideSafeMargin(scene, null)).toEqual([]);
    });
  });

  // 6. LOW_CONTRAST (Error)
  describe("checkLowContrast", () => {
    it("passes high contrast text (black on white = 21:1)", () => {
      const scene = [
        {
          type: "rect",
          id: "bg",
          box: { x: 0, y: 0, w: 54, h: 85.6 },
          fill: "#FFFFFF",
          decor: true,
        },
        {
          type: "text",
          id: "name",
          box: { x: 5, y: 10, w: 44, h: 10 },
          lines: ["Preet Patel"],
          sizeMm: 3.17,
          fill: "#000000",
        },
      ];
      const issues = checkLowContrast(scene, { colors: { background: "#FFFFFF" } });
      expect(issues).toHaveLength(0);
    });

    it("fails low contrast text (light gray #CCCCCC on white = 1.6:1)", () => {
      const scene = [
        {
          type: "rect",
          id: "bg",
          box: { x: 0, y: 0, w: 54, h: 85.6 },
          fill: "#FFFFFF",
          decor: true,
        },
        {
          type: "text",
          id: "name",
          box: { x: 5, y: 10, w: 44, h: 10 },
          lines: ["Preet Patel"],
          sizeMm: 3.17,
          fill: "#CCCCCC",
        },
      ];
      const issues = checkLowContrast(scene, { colors: { background: "#FFFFFF" } });
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("error");
      expect(issues[0].code).toBe("LOW_CONTRAST");
      expect(issues[0].nodeId).toBe("name");
    });

    it("uses 3:1 threshold for large text (>= 6.35 mm)", () => {
      // Dark gray on white with ratio ~3.5:1
      const scene = [
        {
          type: "rect",
          id: "bg",
          box: { x: 0, y: 0, w: 54, h: 85.6 },
          fill: "#FFFFFF",
          decor: true,
        },
        {
          type: "text",
          id: "largeName",
          box: { x: 5, y: 10, w: 44, h: 20 },
          lines: ["BIG TITLE"],
          sizeMm: 7.0, // large text
          fill: "#777777", // contrast ~4.48:1 (below 4.5, but above 3.0)
        },
      ];
      const issues = checkLowContrast(scene, { colors: { background: "#FFFFFF" } });
      expect(issues).toHaveLength(0);
    });
  });

  // 7. UNFILLED_DATA (Error)
  describe("checkUnfilledData", () => {
    it("passes normal text, bare '$', and 'Cash$'", () => {
      const scene = [
        {
          type: "text",
          id: "name",
          box: { x: 5, y: 5, w: 40, h: 10 },
          lines: ["Preet Patel", "$", "Cash$", "Cost is $50 only"],
        },
      ];
      const issues = checkUnfilledData(scene);
      expect(issues).toHaveLength(0);
    });

    it("fails when text contains unfilled placeholders or bindings", () => {
      const scene = [
        {
          type: "text",
          id: "role",
          box: { x: 5, y: 5, w: 40, h: 10 },
          lines: ["$role.color", "{{user.name}}"],
        },
      ];
      const issues = checkUnfilledData(scene);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("error");
      expect(issues[0].code).toBe("UNFILLED_DATA");
      expect(issues[0].nodeId).toBe("role");
    });
  });

  // 8. NO_PHOTO (Warning)
  describe("checkNoPhoto", () => {
    it("passes when person has a valid photo path", () => {
      const issues = checkNoPhoto(personNormal, []);
      expect(issues).toHaveLength(0);
    });

    it("fails with warning when person photo is null", () => {
      const issues = checkNoPhoto(personNoPhoto, []);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("warning");
      expect(issues[0].code).toBe("NO_PHOTO");
      expect(issues[0].nodeId).toBe("photo");
    });
  });

  // 9. LOGO_DISTORTED (Error)
  describe("checkLogoDistorted", () => {
    it("passes when drawn aspect ratio matches source within 0.5%", () => {
      const scene = [
        {
          type: "image",
          id: "logo1",
          box: { x: 5, y: 5, w: 20, h: 10 }, // 2.0
          srcW: 200,
          srcH: 100, // 2.0
        },
      ];
      const issues = checkLogoDistorted(scene);
      expect(issues).toHaveLength(0);
    });

    it("fails when drawn aspect ratio deviates by more than 0.5%", () => {
      const scene = [
        {
          type: "image",
          id: "logo1",
          box: { x: 5, y: 5, w: 20, h: 10 }, // 2.0
          srcW: 100,
          srcH: 100, // 1.0 (100% distortion)
        },
      ];
      const issues = checkLogoDistorted(scene);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("error");
      expect(issues[0].code).toBe("LOGO_DISTORTED");
    });
  });

  // 10. LOGO_TOO_SMALL (Error)
  describe("checkLogoTooSmall", () => {
    it("passes when logo width meets minWidthMm", () => {
      const scene = [
        {
          type: "rect",
          id: "logo1",
          box: { x: 5, y: 5, w: 15, h: 10 }, // 15mm >= 12mm
        },
      ];
      const issues = checkLogoTooSmall(scene, sampleBrandKit);
      expect(issues).toHaveLength(0);
    });

    it("fails when logo width is below minWidthMm", () => {
      const scene = [
        {
          type: "rect",
          id: "logo1",
          box: { x: 5, y: 5, w: 8, h: 6 }, // 8mm < 12mm
        },
      ];
      const issues = checkLogoTooSmall(scene, sampleBrandKit);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("error");
      expect(issues[0].code).toBe("LOGO_TOO_SMALL");
      expect(issues[0].nodeId).toBe("logo1");
    });
  });

  // 11. LOGO_MISSING (Error)
  describe("checkLogoMissing", () => {
    it("passes when logo nodes (or placeholders) exist", () => {
      const scene = [
        { type: "rect", id: "logo1", box: { x: 5, y: 5, w: 15, h: 10 } },
        { type: "rect", id: "logo2", box: { x: 25, y: 5, w: 15, h: 10 } },
      ];
      const issues = checkLogoMissing(scene, sampleBrandKit);
      expect(issues).toHaveLength(0);
    });

    it("fails when a mandatory logo is missing from scene", () => {
      const scene = [
        { type: "rect", id: "logo2", box: { x: 25, y: 5, w: 15, h: 10 } },
      ];
      const issues = checkLogoMissing(scene, sampleBrandKit);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("error");
      expect(issues[0].code).toBe("LOGO_MISSING");
      expect(issues[0].nodeId).toBe("logo1");
    });
  });

  // 12. LOGO_CLEARSPACE (Error)
  describe("checkLogoClearspace", () => {
    it("passes when content elements respect clear space", () => {
      const scene = [
        {
          type: "image",
          id: "logo1",
          box: { x: 5, y: 5, w: 15, h: 10 },
          decor: false,
        },
        {
          type: "rect",
          id: "other",
          box: { x: 25, y: 5, w: 10, h: 10 }, // distance 5mm > 2mm
          decor: false,
        },
      ];
      const issues = checkLogoClearspace(scene, sampleBrandKit);
      expect(issues).toHaveLength(0);
    });

    it("fails when content element enters logo clear space", () => {
      const scene = [
        {
          type: "image",
          id: "logo1",
          box: { x: 5, y: 5, w: 15, h: 10 },
          decor: false,
        },
        {
          type: "rect",
          id: "other",
          box: { x: 21, y: 5, w: 10, h: 10 }, // distance 1mm < 2mm clear space
          decor: false,
        },
      ];
      const issues = checkLogoClearspace(scene, sampleBrandKit);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("error");
      expect(issues[0].code).toBe("LOGO_CLEARSPACE");
      expect(issues[0].nodeId).toBe("logo1");
    });
  });

  // 13. QR_TOO_SMALL (Error)
  describe("checkQrTooSmall", () => {
    it("passes when QR code is at least 15x15 mm", () => {
      const scene = [
        {
          type: "path",
          id: "qr",
          box: { x: 10, y: 10, w: 16, h: 16 },
        },
      ];
      const issues = checkQrTooSmall(scene);
      expect(issues).toHaveLength(0);
    });

    it("fails when QR code is smaller than 15x15 mm", () => {
      const scene = [
        {
          type: "path",
          id: "qr",
          box: { x: 10, y: 10, w: 12, h: 12 },
        },
      ];
      const issues = checkQrTooSmall(scene);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("error");
      expect(issues[0].code).toBe("QR_TOO_SMALL");
      expect(issues[0].nodeId).toBe("qr");
    });
  });

  // 14. UNCONFIRMED_VALUE (Error)
  describe("checkUnconfirmedValue", () => {
    it("passes when all suggestion values are confirmed", () => {
      const validEvent = {
        event: {
          name: { value: "Event", source: "suggestion", confirmed: true },
        },
      };
      const issues = checkUnconfirmedValue(validEvent);
      expect(issues).toHaveLength(0);
    });

    it("fails when any suggestion value is unconfirmed", () => {
      const invalidEvent = {
        event: {
          name: { value: "Event", source: "suggestion", confirmed: false },
        },
      };
      const issues = checkUnconfirmedValue(invalidEvent);
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("error");
      expect(issues[0].code).toBe("UNCONFIRMED_VALUE");
    });
  });

  // 15. Integration with renderCard and fixtures
  describe("Fixture rendering integration", () => {
    const baseInput = {
      event: sampleEventSpec,
      brand: sampleBrandKit,
      card: sampleEventSpec.card,
      font: testFont,
    };

    it("renders normal fixture person with zero errors", () => {
      const result = renderCard({
        ...baseInput,
        person: personNormal,
      });
      const errors = result.issues.filter((i) => i.severity === "error");
      expect(errors).toHaveLength(0);
    });

    it("renders person with 57-character name with exactly TEXT_TRUNCATED warning and zero errors", () => {
      const result = renderCard({
        ...baseInput,
        person: personLongName,
      });
      const errors = result.issues.filter((i) => i.severity === "error");
      expect(errors).toHaveLength(0);

      const warnings = result.issues.filter((i) => i.severity === "warning");
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe("TEXT_TRUNCATED");
      expect(warnings[0].nodeId).toBe("name");
    });

    it("renders person with no photo with exactly NO_PHOTO warning and zero errors", () => {
      const result = renderCard({
        ...baseInput,
        person: personNoPhoto,
      });
      const errors = result.issues.filter((i) => i.severity === "error");
      expect(errors).toHaveLength(0);

      const warnings = result.issues.filter((i) => i.severity === "warning");
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe("NO_PHOTO");
      expect(warnings[0].nodeId).toBe("photo");
    });
  });
});
