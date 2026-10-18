// @ts-check
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import {
  sampleBrandKit,
  sampleEventSpec,
} from "./fixtures.js";
import {
  distance,
  draftsFor,
  filterEligible,
  getCombinations,
  groupKey,
  MIN_PAIR_DISTANCE,
  pickThree,
  scoreGroup,
  WEIGHTS,
} from "./picker.js";
import { renderCard } from "./render.js";
import { stressSet } from "./stressSet.js";
import { loadContent } from "../scripts/loadContent.js";

describe("Task 8: The Picker (Spec 9.2, 9.3, 9.6, Part 15)", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 1. Worked example from Spec 9.2 with fake looks
  // ═══════════════════════════════════════════════════════════════════════
  describe("Spec 9.2 Worked Example", () => {
    const lookMinimal = {
      id: "Minimal",
      attributes: {
        skeleton: "portrait",
        header: "thin-line",
        photo: "circle",
        marker: "side-stripe",
        theme: "light",
      },
      tags: ["minimal"],
      requires: { orientation: ["portrait"], maxRoles: 6, needsPhotoSlot: false },
    };

    const lookBold = {
      id: "Bold",
      attributes: {
        skeleton: "portrait",
        header: "solid",
        photo: "rounded",
        marker: "bottom-bar",
        theme: "blue",
      },
      tags: ["bold"],
      requires: { orientation: ["portrait"], maxRoles: 6, needsPhotoSlot: false },
    };

    const lookTech = {
      id: "Tech",
      attributes: {
        skeleton: "sidebar",
        header: "diagonal",
        photo: "rounded",
        marker: "corner-ribbon",
        theme: "dark",
      },
      tags: ["tech"],
      requires: { orientation: ["portrait"], maxRoles: 6, needsPhotoSlot: false },
    };

    const lookFormal = {
      id: "Formal",
      attributes: {
        skeleton: "portrait",
        header: "solid",
        photo: "square",
        marker: "bottom-bar",
        theme: "light",
      },
      tags: ["formal"],
      requires: { orientation: ["portrait"], maxRoles: 6, needsPhotoSlot: false },
    };

    const lookPlayful = {
      id: "Playful",
      attributes: {
        skeleton: "full-photo",
        header: "none",
        photo: "circle",
        marker: "ribbon",
        theme: "bright",
      },
      tags: ["playful"],
      requires: { orientation: ["portrait"], maxRoles: 3, needsPhotoSlot: true },
    };

    const fakeLooks = [lookMinimal, lookBold, lookTech, lookFormal, lookPlayful];

    // Event with 4 roles, photos available, portrait
    const eventSpec4Roles = {
      card: { orientation: "portrait" },
      roles: ["p1", "p2", "p3", "p4"],
      hasPhotos: true,
    };

    it("filters out Playful because maxRoles is 3 and event has 4 roles", () => {
      const { eligible, removed } = filterEligible(fakeLooks, eventSpec4Roles);
      expect(eligible.map((l) => l.id)).toEqual(["Minimal", "Bold", "Tech", "Formal"]);
      expect(removed).toHaveLength(1);
      expect(removed[0].lookId).toBe("Playful");
      expect(removed[0].reason).toContain("3 roles");
    });

    it("matches exact Spec 9.2 pairwise scores: 7, 5, 3, 9, 3, 10", () => {
      expect(distance(lookMinimal, lookBold)).toBe(7);
      expect(distance(lookMinimal, lookTech)).toBe(10);
      expect(distance(lookMinimal, lookFormal)).toBe(5);
      expect(distance(lookBold, lookTech)).toBe(9);
      expect(distance(lookBold, lookFormal)).toBe(3);
      expect(distance(lookTech, lookFormal)).toBe(10);
    });

    it("winner is Minimal, Bold, Tech with total score 26 (without hints)", () => {
      const eligible = [lookMinimal, lookBold, lookTech, lookFormal];
      const gMinimalBoldTech = [lookMinimal, lookBold, lookTech];
      const gMinimalTechFormal = [lookMinimal, lookTech, lookFormal];
      const gBoldTechFormal = [lookBold, lookTech, lookFormal];
      const gMinimalBoldFormal = [lookMinimal, lookBold, lookFormal];

      expect(scoreGroup(gMinimalBoldTech)).toBe(26); // 7 + 10 + 9
      expect(scoreGroup(gMinimalTechFormal)).toBe(25); // 10 + 5 + 10
      expect(scoreGroup(gBoldTechFormal)).toBe(22); // 9 + 3 + 10
      expect(scoreGroup(gMinimalBoldFormal)).toBe(15); // 7 + 5 + 3

      const winner = pickThree(eligible);
      expect(winner.map((l) => l.id)).toEqual(["Minimal", "Bold", "Tech"]);
    });

    it("with hints tech and bold, winner scores 32 and runner-up scores 28", () => {
      const eligible = [lookMinimal, lookBold, lookTech, lookFormal];
      const hints = ["tech", "bold"];

      const gMinimalBoldTech = [lookMinimal, lookBold, lookTech];
      const gMinimalTechFormal = [lookMinimal, lookTech, lookFormal];

      // Bold has "bold" (+3), Tech has "tech" (+3) -> +6
      expect(scoreGroup(gMinimalBoldTech, hints)).toBe(32);
      // Tech has "tech" (+3) -> +3
      expect(scoreGroup(gMinimalTechFormal, hints)).toBe(28);

      const winner = pickThree(eligible, hints);
      expect(winner.map((l) => l.id)).toEqual(["Minimal", "Bold", "Tech"]);
    });

    it("excluding the winner returns Minimal, Tech, Formal", () => {
      const eligible = [lookMinimal, lookBold, lookTech, lookFormal];
      const hints = ["tech", "bold"];
      const winnerKey = groupKey([lookMinimal, lookBold, lookTech]);

      const secondGroup = pickThree(eligible, hints, [winnerKey]);
      expect(secondGroup.map((l) => l.id)).toEqual(["Minimal", "Tech", "Formal"]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Determinism, tie-breaks, and Spec 9.6 rule (groups with pair < 5 skipped)
  // ═══════════════════════════════════════════════════════════════════════
  describe("Determinism and Spec 9.6 Distinctness Preference", () => {
    it("is completely deterministic across multiple invocations", () => {
      const pool = [
        { id: "A", attributes: { skeleton: "1", header: "1", photo: "1", marker: "1", theme: "1" }, tags: [] },
        { id: "B", attributes: { skeleton: "2", header: "2", photo: "2", marker: "2", theme: "2" }, tags: [] },
        { id: "C", attributes: { skeleton: "3", header: "3", photo: "3", marker: "3", theme: "3" }, tags: [] },
        { id: "D", attributes: { skeleton: "4", header: "4", photo: "4", marker: "4", theme: "4" }, tags: [] },
      ];

      const res1 = pickThree(pool);
      const res2 = pickThree(pool);
      expect(res1.map((l) => l.id)).toEqual(res2.map((l) => l.id));
    });

    it("breaks ties alphabetically by groupKey", () => {
      // Two groups with identical scores
      const l1 = { id: "Z", attributes: { skeleton: "s", header: "h", photo: "p", marker: "m", theme: "t" }, tags: [] };
      const l2 = { id: "Y", attributes: { skeleton: "s", header: "h", photo: "p", marker: "m", theme: "t" }, tags: [] };
      const l3 = { id: "X", attributes: { skeleton: "s", header: "h", photo: "p", marker: "m", theme: "t" }, tags: [] };
      const l4 = { id: "A", attributes: { skeleton: "s", header: "h", photo: "p", marker: "m", theme: "t" }, tags: [] };

      // Candidates will all have distance 0. The group containing 'A' will have groupKey starting with 'A'
      const chosen = pickThree([l1, l2, l3, l4]);
      expect(chosen.map((l) => l.id)).toContain("A");
    });

    it("skips a group with any pair below 5 when another group passes MIN_PAIR_DISTANCE", () => {
      // Group HighScoreLowDist: pair distances 10, 10, 4 (sum = 24, but one pair is 4 < 5)
      // Group GoodSpread: pair distances 5, 5, 5 (sum = 15, all >= 5)
      const lookA = {
        id: "A",
        attributes: { skeleton: "s1", header: "h1", photo: "p1", marker: "m1", theme: "t1" },
        tags: [],
      };
      const lookB = {
        id: "B",
        attributes: { skeleton: "s2", header: "h2", photo: "p1", marker: "m1", theme: "t1" },
        tags: [],
      };
      const lookC = {
        id: "C",
        attributes: { skeleton: "s3", header: "h1", photo: "p1", marker: "m2", theme: "t1" },
        tags: [],
      };
      const lookD = {
        id: "D",
        attributes: { skeleton: "s1", header: "h2", photo: "p1", marker: "m1", theme: "t1" },
        tags: ["boost"],
      };

      // Distances in [A, B, C]: all >= 5
      expect(distance(lookA, lookB)).toBe(5);
      expect(distance(lookA, lookC)).toBe(5);
      expect(distance(lookB, lookC)).toBe(7);

      // Distances involving D: A-D is 2 (< 5), B-D is 3 (< 5)
      expect(distance(lookA, lookD)).toBe(2);
      expect(distance(lookB, lookD)).toBe(3);
      expect(distance(lookC, lookD)).toBe(7);

      // Score of [B, C, D] with hint "boost": 3 + 7 + 7 + 3 = 20
      expect(scoreGroup([lookB, lookC, lookD], ["boost"])).toBe(20);
      // Score of [A, B, C]: 5 + 5 + 7 = 17
      expect(scoreGroup([lookA, lookB, lookC])).toBe(17);

      // Even though [B, C, D] scores higher (20 > 17), it has pair B-D = 3 (< 5)
      // Spec 9.6 prefers groups where every pair >= 5, so [A, B, C] wins!
      const chosen = pickThree([lookA, lookB, lookC, lookD], ["boost"]);
      const [c1, c2, c3] = chosen;
      expect(distance(c1, c2)).toBeGreaterThanOrEqual(MIN_PAIR_DISTANCE);
      expect(distance(c1, c3)).toBeGreaterThanOrEqual(MIN_PAIR_DISTANCE);
      expect(distance(c2, c3)).toBeGreaterThanOrEqual(MIN_PAIR_DISTANCE);
      expect(chosen.map((l) => l.id)).toEqual(["A", "B", "C"]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Subsets (2, 1, 0 eligible) and UI notes
  // ═══════════════════════════════════════════════════════════════════════
  describe("Eligibility Subsets (2, 1, 0) and Notes", () => {
    const l1 = {
      id: "look.1",
      requires: { orientation: ["portrait"], maxRoles: 6, needsPhotoSlot: false },
      attributes: { skeleton: "s1", header: "h1", photo: "p1", marker: "m1", theme: "t1" },
      tags: [],
    };
    const l2 = {
      id: "look.2",
      requires: { orientation: ["portrait"], maxRoles: 6, needsPhotoSlot: false },
      attributes: { skeleton: "s2", header: "h2", photo: "p2", marker: "m2", theme: "t2" },
      tags: [],
    };
    const l3 = {
      id: "look.3",
      requires: { orientation: ["landscape"], maxRoles: 6, needsPhotoSlot: false },
      attributes: { skeleton: "s3", header: "h3", photo: "p3", marker: "m3", theme: "t3" },
      tags: [],
    };

    it("2 eligible looks returns 2 drafts plus an explanatory note", () => {
      const res = draftsFor({
        looks: [l1, l2, l3],
        spec: { card: { orientation: "portrait" }, roles: [1] },
      });
      expect(res.looks).toHaveLength(2);
      expect(res.looks.map((l) => l.id)).toEqual(["look.1", "look.2"]);
      expect(res.notes.some((n) => n.includes("Only 2 looks fit"))).toBe(true);
    });

    it("1 eligible look returns 1 draft plus a note naming the limiting setting", () => {
      const res = draftsFor({
        looks: [l1, l2, l3],
        spec: { card: { orientation: "landscape" }, roles: [1] },
      });
      expect(res.looks).toHaveLength(1);
      expect(res.looks[0].id).toBe("look.3");
      expect(res.notes.some((n) => n.includes("Only 1 look fits"))).toBe(true);
      expect(res.notes.some((n) => n.includes("landscape orientation"))).toBe(true);
    });

    it("0 eligible looks returns empty array plus an explanatory note", () => {
      const res = draftsFor({
        looks: [l1, l2, l3],
        spec: { card: { orientation: "square" }, roles: [1] },
      });
      expect(res.looks).toHaveLength(0);
      expect(res.notes.some((n) => n.includes("No looks fit"))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Failing stress test is dropped and replaced
  // ═══════════════════════════════════════════════════════════════════════
  describe("Stress Test Dropping & Substitution", () => {
    it("drops a look that fails the injected stress test and replaces it from next-best group", () => {
      const lookA = {
        id: "A",
        attributes: { skeleton: "s1", header: "h1", photo: "p1", marker: "m1", theme: "t1" },
        tags: [],
        requires: { orientation: ["portrait"], maxRoles: 6, needsPhotoSlot: false },
      };
      const lookB = {
        id: "B",
        attributes: { skeleton: "s2", header: "h2", photo: "p2", marker: "m2", theme: "t2" },
        tags: [],
        requires: { orientation: ["portrait"], maxRoles: 6, needsPhotoSlot: false },
      };
      const lookC = {
        id: "C",
        attributes: { skeleton: "s3", header: "h3", photo: "p3", marker: "m3", theme: "t3" },
        tags: [],
        requires: { orientation: ["portrait"], maxRoles: 6, needsPhotoSlot: false },
      };
      const lookD = {
        id: "D",
        attributes: { skeleton: "s4", header: "h4", photo: "p4", marker: "m4", theme: "t4" },
        tags: [],
        requires: { orientation: ["portrait"], maxRoles: 6, needsPhotoSlot: false },
      };

      // Injected stress runner: look C produces unfixable errors
      const runStress = (look) => {
        if (look.id === "C") {
          return { ok: false, reason: "Text overflow in header box", errors: [{ code: "TEXT_OVERFLOW" }] };
        }
        return { ok: true, errors: [] };
      };

      const result = draftsFor({
        looks: [lookA, lookB, lookC, lookD],
        spec: { card: { orientation: "portrait" }, roles: [1] },
        runStress,
      });

      // Look C was dropped and replaced with D
      expect(result.looks).toHaveLength(3);
      expect(result.looks.map((l) => l.id)).toEqual(["A", "B", "D"]);
      expect(result.dropped).toHaveLength(1);
      expect(result.dropped[0].lookId).toBe("C");
      expect(result.dropped[0].reason).toContain("Text overflow");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Real templates and example event (Spec 9.6 & Part 15 stress set)
  // ═══════════════════════════════════════════════════════════════════════
  describe("Real Templates with Example Event", () => {
    const content = loadContent();
    const fontPath = resolve(process.cwd(), "assets/fonts/Roboto-VariableFont_wdth,wght.ttf");
    const fontBuf = readFileSync(fontPath);
    const font = opentype.parse(
      fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength)
    );

    it("returns 3 looks with every pair >= 5 and zero validator errors on Part 15 stressSet", () => {
      const drafts = draftsFor({
        looks: content.looks,
        spec: sampleEventSpec,
        compat: content.compatibility,
        font,
        brand: sampleBrandKit,
        skeletons: content.skeletons,
        blocks: content.blocks,
        themes: content.themes,
      });

      expect(drafts.looks).toHaveLength(3);
      const [l1, l2, l3] = drafts.looks;

      // Every pair >= 5
      expect(distance(l1, l2)).toBeGreaterThanOrEqual(MIN_PAIR_DISTANCE);
      expect(distance(l1, l3)).toBeGreaterThanOrEqual(MIN_PAIR_DISTANCE);
      expect(distance(l2, l3)).toBeGreaterThanOrEqual(MIN_PAIR_DISTANCE);

      // Verify zero validator errors on every stress person in stressSet
      for (const look of drafts.looks) {
        for (const person of stressSet) {
          const res = renderCard({
            person,
            event: sampleEventSpec,
            brand: sampleBrandKit,
            card: sampleEventSpec.card,
            font,
            skeleton: content.skeletons[look.skeleton],
            blocks: content.blocks,
            theme: content.themes[look.theme],
            look,
          });
          const errors = (res.issues || []).filter((i) => i.severity === "error");
          expect(errors).toHaveLength(0);
        }
      }
    });

    it("'different ones' (excludedGroups) returns another valid group of 3 looks", () => {
      const firstDrafts = draftsFor({
        looks: content.looks,
        spec: sampleEventSpec,
        compat: content.compatibility,
        font,
        brand: sampleBrandKit,
        skeletons: content.skeletons,
        blocks: content.blocks,
        themes: content.themes,
      });

      const firstGroupKey = groupKey(firstDrafts.looks);

      const secondDrafts = draftsFor({
        looks: content.looks,
        spec: sampleEventSpec,
        excludedGroups: [firstGroupKey],
        compat: content.compatibility,
        font,
        brand: sampleBrandKit,
        skeletons: content.skeletons,
        blocks: content.blocks,
        themes: content.themes,
      });

      expect(secondDrafts.looks).toHaveLength(3);
      const secondGroupKey = groupKey(secondDrafts.looks);
      expect(secondGroupKey).not.toBe(firstGroupKey);

      const [l1, l2, l3] = secondDrafts.looks;
      expect(distance(l1, l2)).toBeGreaterThanOrEqual(MIN_PAIR_DISTANCE);
      expect(distance(l1, l3)).toBeGreaterThanOrEqual(MIN_PAIR_DISTANCE);
      expect(distance(l2, l3)).toBeGreaterThanOrEqual(MIN_PAIR_DISTANCE);

      // Zero validator errors on stressSet
      for (const look of secondDrafts.looks) {
        for (const person of stressSet) {
          const res = renderCard({
            person,
            event: sampleEventSpec,
            brand: sampleBrandKit,
            card: sampleEventSpec.card,
            font,
            skeleton: content.skeletons[look.skeleton],
            blocks: content.blocks,
            theme: content.themes[look.theme],
            look,
          });
          const errors = (res.issues || []).filter((i) => i.severity === "error");
          expect(errors).toHaveLength(0);
        }
      }
    });
  });
});
