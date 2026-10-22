// @ts-check
import { describe, expect, it } from "vitest";
import {
  Block,
  BlockElement,
  BrandKit,
  DesignConfig,
  EventSpec,
  ExportSettings,
  Issue,
  Look,
  Operation,
  Person,
  SceneNode,
  Skeleton,
  Theme,
} from "./schemas.js";
import {
  personLongName,
  personNoPhoto,
  personNormal,
  sampleBlock,
  sampleBrandKit,
  sampleDesignConfig,
  sampleEventSpec,
  sampleExportSettings,
  sampleIssue,
  sampleLook,
  sampleOperations,
  samplePersons,
  sampleSceneNodes,
  sampleSkeleton,
  sampleTheme,
} from "./fixtures.js";

describe("core/schemas", () => {
  // 1. EventSpec
  describe("EventSpec", () => {
    it("validates sampleEventSpec fixture", () => {
      expect(() => EventSpec.parse(sampleEventSpec)).not.toThrow();
    });

    it("rejects invalid schemaVersion", () => {
      const invalid = { ...sampleEventSpec, schemaVersion: 2 };
      expect(() => EventSpec.parse(invalid)).toThrow();
    });

    it("rejects empty roles array", () => {
      const invalid = { ...sampleEventSpec, roles: [] };
      expect(() => EventSpec.parse(invalid)).toThrow();
    });

    it("rejects negative card bleed", () => {
      const invalid = {
        ...sampleEventSpec,
        card: { ...sampleEventSpec.card, bleedMm: -1 },
      };
      expect(() => EventSpec.parse(invalid)).toThrow();
    });
  });

  // 2. Person
  describe("Person", () => {
    it("validates all person fixtures", () => {
      for (const p of samplePersons) {
        expect(() => Person.parse(p)).not.toThrow();
      }
    });

    it("rejects missing name", () => {
      const invalid = { ...personNormal, name: "" };
      expect(() => Person.parse(invalid)).toThrow();
    });

    it("rejects missing id", () => {
      const invalid = { ...personNormal };
      delete invalid.id;
      expect(() => Person.parse(invalid)).toThrow();
    });

    it("accepts null photo and long names", () => {
      expect(Person.parse(personNoPhoto).photo).toBeNull();
      expect(Person.parse(personLongName).flags).toContain("LONG_NAME");
    });
  });

  // 3. BrandKit
  describe("BrandKit", () => {
    it("validates sampleBrandKit fixture", () => {
      expect(() => BrandKit.parse(sampleBrandKit)).not.toThrow();
    });

    it("rejects non-positive logo minimum width", () => {
      const invalid = {
        ...sampleBrandKit,
        logos: {
          ...sampleBrandKit.logos,
          primary: { ...sampleBrandKit.logos.primary, minWidthMm: 0 },
        },
      };
      expect(() => BrandKit.parse(invalid)).toThrow();
    });

    it("rejects missing secondary logo", () => {
      const logos = { ...sampleBrandKit.logos };
      delete logos.secondary;
      const invalid = { ...sampleBrandKit, logos };
      expect(() => BrandKit.parse(invalid)).toThrow();
    });
  });

  // 4. Skeleton
  describe("Skeleton", () => {
    it("validates sampleSkeleton fixture", () => {
      expect(() => Skeleton.parse(sampleSkeleton)).not.toThrow();
    });

    it("rejects empty orientation list", () => {
      const invalid = {
        ...sampleSkeleton,
        supports: { ...sampleSkeleton.supports, orientation: [] },
      };
      expect(() => Skeleton.parse(invalid)).toThrow();
    });

    it("rejects non-positive dimensions", () => {
      const invalid = {
        ...sampleSkeleton,
        size: { w: -10, h: 85.6 },
      };
      expect(() => Skeleton.parse(invalid)).toThrow();
    });
  });

  // 5. Block
  describe("Block", () => {
    it("validates sampleBlock fixture", () => {
      expect(() => Block.parse(sampleBlock)).not.toThrow();
    });

    it("rejects empty elements array", () => {
      const invalid = { ...sampleBlock, elements: [] };
      expect(() => Block.parse(invalid)).toThrow();
    });

    it("rejects element with unsupported type", () => {
      const invalid = {
        ...sampleBlock,
        elements: [
          {
            id: "bad",
            type: "video",
            box: [0, 0, 100, 100],
          },
        ],
      };
      expect(() => Block.parse(invalid)).toThrow();
    });

    it("validates PathBlockElement within BlockElement", () => {
      const validPath = {
        id: "motif-1",
        type: "path",
        box: [0, 0, 100, 100],
        d: "M 0 0 L 10 10 Z",
        fill: "#FF6B35",
        decor: true,
      };
      expect(() => BlockElement.parse(validPath)).not.toThrow();
    });

    it("validates TextBlockElement with and without oneLineFloor", () => {
      const validWithout = {
        id: "name",
        type: "text",
        box: [0, 0, 100, 100],
        bind: "person.name",
        font: "heading",
        size: [9, 5],
        maxLines: 2,
        align: "center",
      };
      expect(() => BlockElement.parse(validWithout)).not.toThrow();

      const validWith = {
        ...validWithout,
        oneLineFloor: 7.5,
      };
      expect(() => BlockElement.parse(validWith)).not.toThrow();

      // Rejected if above start size (9)
      const invalidAbove = {
        ...validWithout,
        oneLineFloor: 10,
      };
      expect(() => BlockElement.parse(invalidAbove)).toThrow();

      // Rejected if below minimum size (5)
      const invalidBelow = {
        ...validWithout,
        oneLineFloor: 4,
      };
      expect(() => BlockElement.parse(invalidBelow)).toThrow();
    });

    it("accepts optional decor flag on BlockElement", () => {
      const rectWithDecor = {
        id: "band",
        type: "rect",
        box: [0, 0, 100, 100],
        fill: "#000000",
        decor: true,
      };
      expect(() => BlockElement.parse(rectWithDecor)).not.toThrow();

      const rectWithoutDecor = {
        id: "band",
        type: "rect",
        box: [0, 0, 100, 100],
        fill: "#000000",
      };
      expect(() => BlockElement.parse(rectWithoutDecor)).not.toThrow();

      const invalidDecor = {
        ...rectWithDecor,
        decor: "yes",
      };
      expect(() => BlockElement.parse(invalidDecor)).toThrow();
    });
  });

  // 6. Theme
  describe("Theme", () => {
    it("validates sampleTheme fixture", () => {
      expect(() => Theme.parse(sampleTheme)).not.toThrow();
    });

    it("rejects missing background color", () => {
      const colors = { ...sampleTheme.colors };
      delete colors.background;
      const invalid = { ...sampleTheme, colors };
      expect(() => Theme.parse(invalid)).toThrow();
    });

    it("rejects missing heading font", () => {
      const fonts = { ...sampleTheme.fonts };
      delete fonts.heading;
      const invalid = { ...sampleTheme, fonts };
      expect(() => Theme.parse(invalid)).toThrow();
    });
  });

  // 7. Look
  describe("Look", () => {
    it("validates sampleLook fixture", () => {
      expect(() => Look.parse(sampleLook)).not.toThrow();
    });

    it("rejects missing skeleton attribute", () => {
      const attributes = { ...sampleLook.attributes };
      delete attributes.skeleton;
      const invalid = { ...sampleLook, attributes };
      expect(() => Look.parse(invalid)).toThrow();
    });

    it("rejects negative maxRoles requirement", () => {
      const invalid = {
        ...sampleLook,
        requires: { ...sampleLook.requires, maxRoles: -1 },
      };
      expect(() => Look.parse(invalid)).toThrow();
    });
  });

  // 8. SceneNode
  describe("SceneNode", () => {
    it("validates rect, image, text, and path scene nodes", () => {
      for (const node of Object.values(sampleSceneNodes)) {
        expect(() => SceneNode.parse(node)).not.toThrow();
      }
    });

    it("rejects unsupported node type", () => {
      const invalid = {
        type: "circle",
        id: "c1",
        box: { x: 0, y: 0, w: 10, h: 10 },
      };
      expect(() => SceneNode.parse(invalid)).toThrow();
    });

    it("rejects invalid text node status", () => {
      const invalid = {
        ...sampleSceneNodes.text,
        status: "overflowing",
      };
      expect(() => SceneNode.parse(invalid)).toThrow();
    });

    it("accepts optional decor flag on SceneNode", () => {
      const nodeWithDecor = {
        ...sampleSceneNodes.rect,
        decor: true,
      };
      expect(() => SceneNode.parse(nodeWithDecor)).not.toThrow();

      const nodeWithoutDecor = {
        ...sampleSceneNodes.rect,
      };
      expect(() => SceneNode.parse(nodeWithoutDecor)).not.toThrow();

      const invalidDecor = {
        ...sampleSceneNodes.rect,
        decor: 123,
      };
      expect(() => SceneNode.parse(invalidDecor)).toThrow();
    });
  });

  // 9. Issue
  describe("Issue", () => {
    it("validates sampleIssue fixture", () => {
      expect(() => Issue.parse(sampleIssue)).not.toThrow();
    });

    it("rejects invalid severity level", () => {
      const invalid = { ...sampleIssue, severity: "critical" };
      expect(() => Issue.parse(invalid)).toThrow();
    });

    it("rejects unknown issue code", () => {
      const invalid = { ...sampleIssue, code: "UNKNOWN_ERROR_CODE" };
      expect(() => Issue.parse(invalid)).toThrow();
    });
  });

  // 10. DesignConfig
  describe("DesignConfig", () => {
    it("validates sampleDesignConfig fixture", () => {
      expect(() => DesignConfig.parse(sampleDesignConfig)).not.toThrow();
    });

    it("rejects negative seed", () => {
      const invalid = { ...sampleDesignConfig, seed: -5 };
      expect(() => DesignConfig.parse(invalid)).toThrow();
    });

    it("rejects missing lookId", () => {
      const invalid = { ...sampleDesignConfig };
      delete invalid.lookId;
      expect(() => DesignConfig.parse(invalid)).toThrow();
    });
  });

  // 11. ExportSettings
  describe("ExportSettings", () => {
    it("validates sampleExportSettings fixture", () => {
      expect(() => ExportSettings.parse(sampleExportSettings)).not.toThrow();
    });

    it("rejects unsupported export format", () => {
      const invalid = { ...sampleExportSettings, format: "docx" };
      expect(() => ExportSettings.parse(invalid)).toThrow();
    });

    it("rejects negative bleed margin", () => {
      const invalid = { ...sampleExportSettings, bleedMm: -0.5 };
      expect(() => ExportSettings.parse(invalid)).toThrow();
    });
  });

  // 12. Operation
  describe("Operation", () => {
    it("validates all 12 operation fixtures", () => {
      for (const op of sampleOperations) {
        expect(() => Operation.parse(op)).not.toThrow();
      }
    });

    it("rejects unknown operation name", () => {
      const invalid = { op: "deleteCard", id: "card1" };
      expect(() => Operation.parse(invalid)).toThrow();
    });

    it("rejects resizeElement with scale out of bounds (< 0.5 or > 1.5)", () => {
      const tooBig = { op: "resizeElement", id: "logo1", scale: 2.0 };
      const tooSmall = { op: "resizeElement", id: "logo1", scale: 0.1 };
      expect(() => Operation.parse(tooBig)).toThrow();
      expect(() => Operation.parse(tooSmall)).toThrow();
    });

    it("rejects setAccentColor with non-hex color string", () => {
      const invalid = { op: "setAccentColor", value: "red" };
      expect(() => Operation.parse(invalid)).toThrow();
    });
  });
});
