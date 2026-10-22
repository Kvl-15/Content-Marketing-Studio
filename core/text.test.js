// @ts-check
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import { fitText, measure, PT_TO_MM, textToPathData, wrap } from "./text.js";
import { renderCard } from "./render.js";
import {
  personLongName,
  personNormal,
  sampleBrandKit,
  sampleEventSpec,
} from "./fixtures.js";
import { ARCHETYPES, compose } from "./composer.js";
import { loadContent } from "../scripts/loadContent.js";

const { skeletons, blocks, themes } = loadContent();

// Load test font from assets/fonts
const fontPath = resolve(
  process.cwd(),
  "assets/fonts/Roboto-VariableFont_wdth,wght.ttf",
);
const fontBuf = readFileSync(fontPath);
const testFont = opentype.parse(
  fontBuf.buffer.slice(
    fontBuf.byteOffset,
    fontBuf.byteOffset + fontBuf.byteLength,
  ),
);

describe("core/text engine", () => {
  const boxWidthMm = 41.4; // 90% of 46mm info slot

  describe("measure", () => {
    it("returns 0 for empty string", () => {
      expect(measure("", 3.1752, testFont)).toBe(0);
    });

    it("reports longer text as wider", () => {
      const shortWidth = measure("Alex", 3.1752, testFont);
      const longWidth = measure("Alexander Montgomery", 3.1752, testFont);
      expect(longWidth).toBeGreaterThan(shortWidth);
    });

    it("reports larger font size as wider", () => {
      const smallSize = measure("Preet Patel", 2.0, testFont);
      const largeSize = measure("Preet Patel", 3.5, testFont);
      expect(largeSize).toBeGreaterThan(smallSize);
    });

    it("measures names containing & and accents without throwing", () => {
      const w1 = measure("Aarav & Dev", 3.1752, testFont);
      const w2 = measure("René François", 3.1752, testFont);
      expect(w1).toBeGreaterThan(0);
      expect(w2).toBeGreaterThan(0);
    });
  });

  describe("wrap", () => {
    it("fits a normal two-word name on one line when box is wide", () => {
      const lines = wrap("Preet Patel", 50, 3.1752, testFont);
      expect(lines).toEqual(["Preet Patel"]);
    });

    it("wraps a long name into 2 lines at spaces", () => {
      const lines = wrap(
        "Dr. Anuradha Priyadarshini Mukherjee",
        41.4,
        3.1752,
        testFont,
      );
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe("Dr. Anuradha Priyadarshini");
      expect(lines[1]).toBe("Mukherjee");
    });

    it("splits a 60-letter word with no spaces and no line exceeds the box", () => {
      const longWord = "A".repeat(60);
      const lines = wrap(longWord, 30, 3.1752, testFont, true);
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) {
        expect(measure(line, 3.1752, testFont)).toBeLessThanOrEqual(30.01);
      }
    });
  });

  describe("fitText (D-20)", () => {
    it("Preet Patel stays at 9 pt on one line", () => {
      const res = fitText({
        text: "Preet Patel",
        boxWidthMm,
        sizeRangePt: [9, 6.5],
        oneLineFloorPt: 7.5,
        maxLines: 2,
        font: testFont,
      });
      expect(res.status).toBe("ok");
      expect(res.lines).toEqual(["Preet Patel"]);
      expect(res.sizeMm / PT_TO_MM).toBeCloseTo(9, 0);
    });

    it("renders a name needing small shrink on ONE line between 7.5 and 9 pt", () => {
      // "Anuradha Priyadarshini Mukherjee" on one line exceeds 9 pt, fits at ~7.65 pt
      const res = fitText({
        text: "Anuradha Priyadarshini Mukherjee",
        boxWidthMm,
        sizeRangePt: [9, 6.5],
        oneLineFloorPt: 7.5,
        maxLines: 2,
        font: testFont,
      });
      expect(res.status).toBe("ok");
      expect(res.lines.length).toBe(1);
      const pt = res.sizeMm / PT_TO_MM;
      expect(pt).toBeGreaterThanOrEqual(7.5);
      expect(pt).toBeLessThanOrEqual(9.01);
    });

    it("splits a name needing more than shrink into exactly 2 lines above 7.5 pt", () => {
      const res = fitText({
        text: "Dr. Anuradha Priyadarshini Mukherjee",
        boxWidthMm,
        sizeRangePt: [9, 6.5],
        oneLineFloorPt: 7.5,
        maxLines: 2,
        font: testFont,
      });
      expect(res.status).toBe("ok");
      expect(res.lines.length).toBe(2);
      const pt = res.sizeMm / PT_TO_MM;
      expect(pt).toBeGreaterThan(7.5);
    });

    it("a single 28-letter word is shrunk, not split, if it fits at >= 6.5 pt", () => {
      const word28 = "Antidisestablishmentarianism";
      const res = fitText({
        text: word28,
        boxWidthMm,
        sizeRangePt: [9, 6.5],
        oneLineFloorPt: 7.5,
        maxLines: 2,
        font: testFont,
      });
      expect(res.status).toBe("ok");
      expect(res.lines).toEqual([word28]);
      const pt = res.sizeMm / PT_TO_MM;
      expect(pt).toBeGreaterThanOrEqual(6.5);
    });

    it("the 57-character fixture name returns status 'truncated', ends with '...', has at most 2 lines, size >= 6.5 pt", () => {
      const res = fitText({
        text: personLongName.name,
        boxWidthMm,
        sizeRangePt: [9, 6.5],
        oneLineFloorPt: 7.5,
        maxLines: 2,
        font: testFont,
      });
      expect(res.status).toBe("truncated");
      expect(res.lines.length).toBeLessThanOrEqual(2);
      expect(res.lines[res.lines.length - 1].endsWith("...")).toBe(true);
      expect(res.sizeMm / PT_TO_MM).toBeGreaterThanOrEqual(6.5);
      for (const line of res.lines) {
        expect(measure(line, res.sizeMm, testFont)).toBeLessThanOrEqual(
          boxWidthMm + 0.01,
        );
      }
    });

    it("no name text node is ever below 6.5 pt or has more than 2 lines, no line wider than box", () => {
      const testNames = [
        "Preet Patel",
        "Anuradha Priyadarshini Mukherjee",
        "Dr. Anuradha Priyadarshini Mukherjee",
        "Antidisestablishmentarianism",
        personLongName.name,
        "A".repeat(100),
      ];

      for (const name of testNames) {
        const res = fitText({
          text: name,
          boxWidthMm,
          sizeRangePt: [9, 6.5],
          oneLineFloorPt: 7.5,
          maxLines: 2,
          font: testFont,
        });
        expect(res.lines.length).toBeLessThanOrEqual(2);
        expect(res.sizeMm / PT_TO_MM).toBeGreaterThanOrEqual(6.49);
        for (const line of res.lines) {
          expect(measure(line, res.sizeMm, testFont)).toBeLessThanOrEqual(
            boxWidthMm + 0.05,
          );
        }
      }
    });
  });

  describe("renderCard with text fitting and issues", () => {
    it("emits a TEXT_TRUNCATED warning for personLongName", () => {
      const res = renderCard({
        person: personLongName,
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        font: testFont,
        skeleton: skeletons.portrait,
        blocks,
        theme: themes["brand-blue"],
      });

      const nameNode = res.scene.find((n) => n.id === "name");
      expect(nameNode).toBeDefined();
      if (nameNode && nameNode.type === "text") {
        expect(nameNode.status).toBe("truncated");
        expect(nameNode.lines[nameNode.lines.length - 1].endsWith("...")).toBe(
          true,
        );
        expect(nameNode.sizeMm / PT_TO_MM).toBeGreaterThanOrEqual(6.5);
        for (const line of nameNode.lines) {
          expect(measure(line, nameNode.sizeMm, testFont)).toBeLessThanOrEqual(
            nameNode.box.w + 0.01,
          );
        }
      }

      const truncatedIssue = res.issues.find(
        (i) => i.code === "TEXT_TRUNCATED" && i.nodeId === "name",
      );
      expect(truncatedIssue).toBeDefined();
      expect(truncatedIssue?.severity).toBe("warning");
    });

    it("renders names with & and accents in valid XML and without issues", () => {
      const res = renderCard({
        person: { ...personNormal, name: "René & François" },
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        font: testFont,
        skeleton: skeletons.portrait,
        blocks,
        theme: themes["brand-blue"],
      });

      expect(res.svg).toContain("René &amp; François");
      expect(res.issues.length).toBe(0);
      const nameNode = res.scene.find((n) => n.id === "name");
      expect(nameNode?.type === "text" && nameNode.status).toBe("ok");
    });
  });

  describe("Task T1: Text-Fitting Step Rounding Fix & Regression Tests", () => {
    const fonts = {
      heading: opentype.parse(
        readFileSync(
          resolve(process.cwd(), "assets/fonts/SpaceGrotesk-Bold.ttf"),
        ).buffer,
      ),
      body: opentype.parse(
        readFileSync(resolve(process.cwd(), "assets/fonts/Inter-Regular.ttf"))
          .buffer,
      ),
    };

    const ARCHETYPES = [
      "hero-photo-top",
      "colour-block-split",
      "circle-badge-centre",
      "typographic-name-first",
    ];
    const MODES = ["light", "dark", "colour-field"];

    it("(a) 'HX26-P-001' in real id-line box fits with status 'ok' and no ellipsis across all 4 archetypes x 3 modes", () => {
      for (const arch of ARCHETYPES) {
        for (const mode of MODES) {
          const bundle = compose(sampleEventSpec, "test-seed", arch, mode);
          const res = renderCard({
            person: {
              id: "HX26-P-001",
              name: "Preet Patel",
              roleId: "participant",
              org: "SVNIT",
            },
            event: sampleEventSpec,
            brand: sampleBrandKit,
            card: sampleEventSpec.card,
            fonts,
            skeleton: bundle.skeleton,
            blocks: bundle.blocks,
            theme: bundle.theme,
            look: bundle.look,
          });
          const idNode = res.scene.find((n) => n.id === "id-line");
          expect(idNode).toBeDefined();
          expect(idNode?.type === "text" && idNode.status).toBe("ok");
          expect(idNode?.type === "text" && idNode.lines).toEqual([
            "HX26-P-001",
          ]);
          expect(
            idNode?.type === "text" && idNode.lines[0].endsWith("..."),
          ).toBe(false);

          const trunc = res.issues.filter(
            (i) => i.code === "TEXT_TRUNCATED" && i.nodeId === "id-line",
          );
          expect(trunc.length).toBe(0);
        }
      }
    });

    it("(b) 40-character and 64-character IDs truncate gracefully with warning and no crash", () => {
      const bundle = compose(
        sampleEventSpec,
        "test-seed",
        "hero-photo-top",
        "light",
      );
      for (const len of [40, 64]) {
        const longId = "HX26-P-" + "X".repeat(len - 7);
        const res = renderCard({
          person: {
            id: longId,
            name: "Preet Patel",
            roleId: "participant",
            org: "SVNIT",
          },
          event: sampleEventSpec,
          brand: sampleBrandKit,
          card: sampleEventSpec.card,
          fonts,
          skeleton: bundle.skeleton,
          blocks: bundle.blocks,
          theme: bundle.theme,
          look: bundle.look,
        });
        const idNode = res.scene.find((n) => n.id === "id-line");
        expect(idNode).toBeDefined();
        expect(idNode?.type === "text" && idNode.status).toBe("truncated");
        expect(idNode?.type === "text" && idNode.lines[0].endsWith("...")).toBe(
          true,
        );
        if (idNode?.type === "text") {
          expect(
            measure(idNode.lines[0], idNode.sizeMm, fonts.body),
          ).toBeLessThanOrEqual(idNode.box.w + 0.05);
        }

        const trunc = res.issues.find(
          (i) => i.code === "TEXT_TRUNCATED" && i.nodeId === "id-line",
        );
        expect(trunc).toBeDefined();
        expect(trunc?.severity).toBe("warning");
      }
    });

    it("(c) text that really does not fit at 5.5 pt still ends with '...' and status 'truncated'", () => {
      const longText =
        "Very Long Organization Name That Cannot Fit In Small Space";
      const res = fitText({
        text: longText,
        boxWidthMm: 20,
        sizeRangePt: [5.5, 5.5],
        maxLines: 1,
        font: testFont,
      });
      expect(res.status).toBe("truncated");
      expect(res.lines[0].endsWith("...")).toBe(true);
      expect(measure(res.lines[0], res.sizeMm, testFont)).toBeLessThanOrEqual(
        20.01,
      );
    });

    it("(d) no text size is below 5.5 pt anywhere across all archetypes and modes", () => {
      for (const arch of ARCHETYPES) {
        for (const mode of MODES) {
          const bundle = compose(sampleEventSpec, "test-seed", arch, mode);
          const res = renderCard({
            person: {
              id: "HX26-P-001",
              name: "Preet Patel",
              roleId: "participant",
              org: "SVNIT",
            },
            event: sampleEventSpec,
            brand: sampleBrandKit,
            card: sampleEventSpec.card,
            fonts,
            skeleton: bundle.skeleton,
            blocks: bundle.blocks,
            theme: bundle.theme,
            look: bundle.look,
          });
          for (const node of res.scene) {
            if (node.type === "text" && typeof node.sizeMm === "number") {
              const pt = node.sizeMm / PT_TO_MM;
              expect(pt).toBeGreaterThanOrEqual(5.49);
            }
          }
        }
      }
    });

    it("(e) every start==min value from scan (5.5 to 16 pt in 0.1 steps) behaves correctly without skipping Stage 1", () => {
      for (let pt10 = 55; pt10 <= 160; pt10++) {
        const pt = pt10 / 10;
        const res = fitText({
          text: "ID-123",
          boxWidthMm: 80,
          sizeRangePt: [pt, pt],
          maxLines: 1,
          font: testFont,
        });
        expect(res.status).toBe("ok");
        expect(res.lines).toEqual(["ID-123"]);
        expect(res.sizeMm / PT_TO_MM).toBeGreaterThanOrEqual(pt - 0.05);
      }
    });

    it("(f) rendering determinism is preserved", () => {
      const bundle = compose(
        sampleEventSpec,
        "deterministic-seed",
        "hero-photo-top",
        "light",
      );
      const input = {
        person: {
          id: "HX26-P-001",
          name: "Preet Patel",
          roleId: "participant",
          org: "SVNIT",
        },
        event: sampleEventSpec,
        brand: sampleBrandKit,
        card: sampleEventSpec.card,
        fonts,
        skeleton: bundle.skeleton,
        blocks: bundle.blocks,
        theme: bundle.theme,
        look: bundle.look,
      };
      const res1 = renderCard(input);
      const res2 = renderCard(input);
      expect(res1.svg).toBe(res2.svg);
      expect(res1.scene).toEqual(res2.scene);
      expect(res1.issues).toEqual(res2.issues);
    });

    it("(Condition 3) every node sizeMm in rendered scenes across 4 archetypes x 3 modes matches expected sizes", () => {
      for (const arch of ARCHETYPES) {
        for (const mode of MODES) {
          const bundle = compose(sampleEventSpec, "test-seed", arch, mode);
          const res = renderCard({
            person: {
              id: "HX26-P-001",
              name: "Preet Patel",
              roleId: "participant",
              org: "SVNIT",
            },
            event: sampleEventSpec,
            brand: sampleBrandKit,
            card: sampleEventSpec.card,
            fonts,
            skeleton: bundle.skeleton,
            blocks: bundle.blocks,
            theme: bundle.theme,
            look: bundle.look,
          });
          const idNode = res.scene.find((n) => n.id === "id-line");
          expect(idNode?.sizeMm).toBe(2); // 5.5 pt clamped step 20 = 2.0 mm
          const nameNode = res.scene.find((n) => n.id === "name");
          expect(nameNode?.sizeMm).toBeGreaterThanOrEqual(9 * PT_TO_MM - 0.05);
        }
      }
    });

    it(
      "ensures textToPathData renders printable ASCII across sizes 5.5 to 16 pt with zero NaN in path data",
      () => {
        const allFonts = [
          opentype.parse(
            readFileSync(resolve(process.cwd(), "assets/fonts/SpaceGrotesk-Bold.ttf")).buffer,
          ),
          opentype.parse(
            readFileSync(resolve(process.cwd(), "assets/fonts/SourceSerif4-Bold.ttf")).buffer,
          ),
          opentype.parse(
            readFileSync(resolve(process.cwd(), "assets/fonts/Inter-Regular.ttf")).buffer,
          ),
          opentype.parse(
            readFileSync(resolve(process.cwd(), "assets/fonts/SourceSans3-Regular.ttf")).buffer,
          ),
        ];

        let ascii = "";
        for (let c = 32; c <= 126; c++) ascii += String.fromCharCode(c);

        const testStrings = [
          "A",
          "HX26-P-001",
          "ROBOWARS SURAT",
          "DESIGNSPRINT NIT",
          "OPENSOURCE CARNIVAL",
          "Preet Patel",
          "SVNIT, Surat",
          ascii,
        ];

        for (const font of allFonts) {
          for (let pt10 = 55; pt10 <= 160; pt10 += 5) {
            const sizeMm = (pt10 / 10) * PT_TO_MM;
            for (const str of testStrings) {
              const pData = textToPathData(str, 5.0, 20.0, sizeMm, font);
              expect(pData.includes("NaN")).toBe(false);
              expect(pData.length).toBeGreaterThan(0);
            }
          }
        }
      },
      20000,
    );

    it(
      "ensures every archetype x mode x every gallery event renders SVG with zero NaN in path d attributes",
      () => {
      const galleryEvents = [
        {
          name: "HackSurat 2026",
          tagline: "36-Hour National Student Hackathon",
          palette: ["#0F172A", "#38BDF8"],
          venue: "SVNIT Campus, Surat",
        },
        {
          name: "ACM Computing Symposium",
          tagline: "Advances in Systems and Machine Learning",
          palette: ["#1E3A2F", "#F5EBE0"],
          venue: "Central Seminar Hall",
        },
        {
          name: "DesignSprint NIT",
          tagline: "Product Strategy & UI/UX Sprint",
          palette: ["#4A154B", "#E01E5A"],
          venue: "Design Innovation Centre",
        },
        {
          name: "CyberShield Expo",
          tagline: "Defense, Forensics and Zero-Trust",
          palette: ["#09090B", "#22C55E"],
          venue: "Auditorium A",
        },
        {
          name: "ACM Annual Gala",
          tagline: "Celebrating 15 Years of Excellence",
          palette: ["#1E1B4B", "#FBBF24"],
          venue: "Grand Ballroom, Surat",
        },
        {
          name: "AI Horizons Conclave",
          tagline: "Foundation Models in Production",
          palette: ["#1E40AF", "#93C5FD"],
          venue: "Computer Science Dept",
        },
        {
          name: "RoboWars Surat",
          tagline: "Combat Robotics Championship",
          palette: ["#7F1D1D", "#F97316"],
          venue: "Mechanical Quadrangle",
        },
        {
          name: "Women in Tech Surat",
          tagline: "Empowering Next-Gen Tech Leaders",
          palette: ["#831843", "#F472B6"],
          venue: "Student Activity Center",
        },
        {
          name: "OpenSource Carnival",
          tagline: "Code, Collaborate, and Contribute",
          palette: ["#064E3B", "#34D399"],
          venue: "Open Air Theatre",
        },
        {
          name: "FounderSpark Pitch",
          tagline: "Student Startups Demo Day",
          palette: ["#312E81", "#A78BFA"],
          venue: "Incubation Center",
        },
      ];

      for (const arch of ARCHETYPES) {
        for (const mode of MODES) {
          for (const ev of galleryEvents) {
            const evSpec = {
              ...sampleEventSpec,
              event: {
                ...sampleEventSpec.event,
                name: { value: ev.name, source: "user", confirmed: true },
                tagline: { value: ev.tagline, source: "user", confirmed: true },
                venue: { value: ev.venue, source: "user", confirmed: true },
                palette: ev.palette,
              },
            };
            const bundle = compose(evSpec, 1001, arch, mode);
            const res = renderCard({
              person: {
                id: "HX26-P-001",
                name: "Preet Patel",
                roleId: "participant",
                org: "SVNIT",
              },
              event: evSpec,
              brand: sampleBrandKit,
              card: evSpec.card,
              fonts,
              skeleton: bundle.skeleton,
              blocks: bundle.blocks,
              theme: bundle.theme,
              look: bundle.look,
            });

            const paths = res.svg.match(/<path[^>]*d="[^"]*"/g) || [];
            for (const p of paths) {
              expect(p.includes("NaN")).toBe(false);
            }
          }
        }
      }
    }, 20000);

    describe("formatCommandsWithoutNaN", () => {
      // Extract formatCommandsWithoutNaN from core/text.js source to test directly without mutating core/text.js
      const textJsSrc = readFileSync(
        resolve(process.cwd(), "core/text.js"),
        "utf8",
      );
      const fnMatch = textJsSrc.match(
        /function formatCommandsWithoutNaN\([\s\S]*?\n\}/,
      );
      const formatCommandsWithoutNaN = fnMatch
        ? new Function(`${fnMatch[0]}; return formatCommandsWithoutNaN;`)()
        : null;

      it("feeds commands that would produce NaN and asserts output never contains NaN and numbers are correctly rounded", () => {
        expect(typeof formatCommandsWithoutNaN).toBe("function");

        const pathologicalCommands = [
          // M command with explicit NaN and epsilon floating point noise
          { type: "M", x: NaN, y: 1.7763568394002505e-15 },
          // L command with fractional values requiring rounding, and NaN coordinate
          { type: "L", x: 10.123456, y: NaN },
          // C command with mixed NaNs, sub-epsilon numbers, and multi-decimal coords
          {
            type: "C",
            x1: NaN,
            y1: 20.55555,
            x2: 30.1,
            y2: NaN,
            x: 40.9999,
            y: -0,
          },
          // Q command with NaNs and unrounded floats
          { type: "Q", x1: NaN, y1: NaN, x: 60.1234, y: 70.8888 },
          // Z closepath
          { type: "Z" },
        ];

        const pathData = formatCommandsWithoutNaN(pathologicalCommands);

        // Assert zero "NaN" tokens appear in the SVG path data
        expect(pathData).not.toContain("NaN");

        // Assert numbers are correctly rounded to at most 3 decimal places
        // 10.123456 -> 10.123
        expect(pathData).toContain("L10.123 0");
        // 20.55555 -> 20.556, 40.9999 -> 41
        expect(pathData).toContain("C0 20.556 30.1 0 41 0");
        // 60.1234 -> 60.123, 70.8888 -> 70.889
        expect(pathData).toContain("Q0 0 60.123 70.889");
        // M command replaced NaN and 1e-15 with 0
        expect(pathData.startsWith("M0 0")).toBe(true);
        expect(pathData.endsWith("Z")).toBe(true);
      });

      it("handles all standard SVG command types gracefully with zero or empty input", () => {
        expect(formatCommandsWithoutNaN([])).toBe("");
        expect(
          formatCommandsWithoutNaN([
            { type: "M", x: 12.3, y: 45.6 },
            { type: "Z" },
          ]),
        ).toBe("M12.3 45.6Z");
      });
    });
  });

  describe("60-character event name fit", () => {
    it("event name with exactly 60 characters fits without clipping, truncation or EVENT_NAME_DOES_NOT_FIT across all archetypes", () => {
      const eventName60 =
        "ACM International Conference on Ubiquitous Systems Computing";
      expect(eventName60.length).toBe(60);

      const ev60 = {
        ...sampleEventSpec,
        event: {
          ...sampleEventSpec.event,
          name: eventName60,
        },
      };

      for (const archetype of ARCHETYPES) {
        const bundle = compose(ev60, `seed-60-${archetype}`, archetype);
        const res = renderCard({
          person: personNormal,
          event: ev60,
          brand: sampleBrandKit,
          font: testFont,
          ...bundle,
        });

        const evNode = res.scene.find(
          (n) => n.bind === "event.name" || n.id === "event-name",
        );
        expect(evNode).toBeDefined();
        // Event name must never be truncated or clipped
        expect(evNode.lines.join(" ")).not.toContain("...");
        expect(evNode.lines.length).toBeLessThanOrEqual(2);
        // Size must stay at or above the 5.5 pt floor
        const sizePt = evNode.sizeMm / PT_TO_MM;
        expect(sizePt).toBeGreaterThanOrEqual(5.5);
        // Validator issues must contain zero clipping or truncation errors
        const badIssues = res.issues.filter(
          (i) =>
            i.code === "TEXT_TRUNCATED" ||
            i.code === "EVENT_NAME_DOES_NOT_FIT" ||
            i.code === "TEXT_OVERFLOW",
        );
        expect(badIssues).toHaveLength(0);
      }
    });
  });
});
