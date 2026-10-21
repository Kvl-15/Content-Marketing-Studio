// @ts-check
import { describe, it, expect } from "vitest";
import {
  isStressSetIssue,
  partitionPreflightIssues,
  evaluateExportGate,
  getDesignSelectionState,
  isSameDesign,
} from "./preflightClassification.js";

describe("preflightClassification: isStressSetIssue", () => {
  const currentPeople = [
    { id: "attendee_001", name: "Alice" },
    { id: "attendee_002", name: "Bob" },
    { id: "HX26-S-005", name: "Real Person Reusing Id" },
  ];

  it("classifies issue with source: 'stress-set' as stress", () => {
    const issue = {
      code: "NO_PHOTO",
      severity: "warning",
      nodeId: "photo",
      source: "stress-set",
      message: "Participant has no photo; fallback avatar or placeholder used",
    };
    expect(isStressSetIssue(issue, currentPeople)).toBe(true);
  });

  it("classifies legacy synthetic issue with HX26-S-007 as stress when id is not in current people", () => {
    const issue = {
      code: "NO_PHOTO",
      severity: "warning",
      nodeId: "photo",
      personId: "HX26-S-007",
      message: "Participant has no photo",
    };
    expect(isStressSetIssue(issue, currentPeople)).toBe(true);
  });

  it("strictly classifies issue as real if personId exists in current people (even with HX26-S id)", () => {
    const issue = {
      code: "UNKNOWN_ROLE_ID",
      severity: "error",
      personId: "HX26-S-005", // Present in currentPeople!
      message: "Unknown role",
    };
    expect(isStressSetIssue(issue, currentPeople)).toBe(false);
  });

  it("strictly classifies genuine NO_PHOTO for a real attendee as real", () => {
    const issue = {
      code: "NO_PHOTO",
      severity: "warning",
      nodeId: "photo",
      personId: "attendee_001",
      message: "Participant has no photo",
    };
    expect(isStressSetIssue(issue, currentPeople)).toBe(false);
  });

  it("classifies legacy untagged issue with no person field (like stored NO_PHOTO from drafts) as stress-set", () => {
    // Real shape from stored MongoDB drafts in versions 1 to 4
    const legacyNoPhoto = {
      code: "NO_PHOTO",
      severity: "warning",
      nodeId: "photo",
      message: "Participant has no photo; fallback avatar or placeholder used",
    };
    expect(isStressSetIssue(legacyNoPhoto, currentPeople)).toBe(true);

    const legacyTextTrunc = {
      code: "TEXT_TRUNCATED",
      severity: "warning",
      nodeId: "name",
      message: 'Text was truncated to fit the available space: "Dr. Rajeshwari..."',
    };
    expect(isStressSetIssue(legacyTextTrunc, currentPeople)).toBe(true);
  });

  it("extracts personId from legacy message pattern if present", () => {
    const msgIssue = {
      code: "UNKNOWN_ROLE_ID",
      severity: "error",
      message: 'Person "HX26-S-002" has invalid or unrecognised roleId "participant"',
    };
    expect(isStressSetIssue(msgIssue, currentPeople)).toBe(true);

    const realMsgIssue = {
      code: "UNKNOWN_ROLE_ID",
      severity: "error",
      message: 'Person "attendee_002" has invalid or unrecognised roleId "participant"',
    };
    expect(isStressSetIssue(realMsgIssue, currentPeople)).toBe(false);
  });

  it("handles bad/malformed input gracefully without crashing (treated as real/unclassified)", () => {
    expect(isStressSetIssue(null, currentPeople)).toBe(false);
    expect(isStressSetIssue(undefined, currentPeople)).toBe(false);
    expect(isStressSetIssue({}, currentPeople)).toBe(false);
    expect(isStressSetIssue({ code: "" }, currentPeople)).toBe(false);
    expect(isStressSetIssue("string-not-object", currentPeople)).toBe(false);
  });
});

describe("preflightClassification: partitionPreflightIssues", () => {
  it("partitions mixed issues into attendeeIssues and stressTestIssues", () => {
    const currentPeople = [{ id: "attendee_001" }, { id: "attendee_002" }];
    const issues = [
      { code: "NO_PHOTO", severity: "warning", nodeId: "photo", message: "Fallback" }, // legacy stress
      { code: "TEXT_TRUNCATED", severity: "warning", source: "stress-set" }, // modern stress
      { code: "OUTSIDE_SAFE_MARGIN", severity: "warning", personId: "attendee_001" }, // real warning
      { code: "UNKNOWN_ROLE_ID", severity: "error", personId: "attendee_002" }, // real error
    ];

    const { attendeeIssues, stressTestIssues } = partitionPreflightIssues(issues, currentPeople);
    expect(stressTestIssues).toHaveLength(2);
    expect(attendeeIssues).toHaveLength(2);
    expect(attendeeIssues[0].code).toBe("OUTSIDE_SAFE_MARGIN");
    expect(attendeeIssues[1].code).toBe("UNKNOWN_ROLE_ID");
  });

  it("handles empty or non-array input safely", () => {
    expect(partitionPreflightIssues(null)).toEqual({ attendeeIssues: [], stressTestIssues: [] });
    expect(partitionPreflightIssues(undefined)).toEqual({ attendeeIssues: [], stressTestIssues: [] });
    expect(partitionPreflightIssues([])).toEqual({ attendeeIssues: [], stressTestIssues: [] });
  });
});

describe("preflightClassification: evaluateExportGate", () => {
  it("enables export without tick when only stress-set issues exist (attendeeIssues is empty)", () => {
    const result = evaluateExportGate({
      attendeeIssues: [],
      acknowledgedWarnings: false,
    });
    expect(result.canExport).toBe(true);
    expect(result.requiresAcknowledgement).toBe(false);
    expect(result.hasErrors).toBe(false);
    expect(result.hasWarnings).toBe(false);
    expect(result.reason).toBe("READY");
  });

  it("requires warning acknowledgement tick when real warning exists", () => {
    const realWarning = [{ severity: "warning", code: "PHOTO_LOW_RES", personId: "p1" }];

    // Without acknowledgement -> blocked
    const unack = evaluateExportGate({
      attendeeIssues: realWarning,
      acknowledgedWarnings: false,
    });
    expect(unack.canExport).toBe(false);
    expect(unack.requiresAcknowledgement).toBe(true);
    expect(unack.hasWarnings).toBe(true);
    expect(unack.reason).toBe("REQUIRES_ACK");

    // With acknowledgement -> enabled
    const ack = evaluateExportGate({
      attendeeIssues: realWarning,
      acknowledgedWarnings: true,
    });
    expect(ack.canExport).toBe(true);
    expect(ack.requiresAcknowledgement).toBe(false);
    expect(ack.hasWarnings).toBe(true);
    expect(ack.reason).toBe("ACKNOWLEDGED");
  });

  it("blocks export unconditionally when a real error exists, even if acknowledged", () => {
    const realError = [{ severity: "error", code: "UNKNOWN_ROLE_ID", personId: "p1" }];

    const blocked = evaluateExportGate({
      attendeeIssues: realError,
      acknowledgedWarnings: true, // Should still block!
    });
    expect(blocked.canExport).toBe(false);
    expect(blocked.hasErrors).toBe(true);
    expect(blocked.requiresAcknowledgement).toBe(false);
    expect(blocked.reason).toBe("BLOCKED_ERROR");
  });

  it("handles bad/missing inputs gracefully without crashing", () => {
    expect(evaluateExportGate().canExport).toBe(true);
    expect(evaluateExportGate({ attendeeIssues: null }).canExport).toBe(true);
  });
});

describe("preflightClassification: getDesignSelectionState & isSameDesign", () => {
  const baseDraft = {
    seed: "12345-0",
    look: { seed: "12345-0", attributes: { archetype: "bold", mode: "dark" } },
  };

  it("identifies matching designs by seed and archetype", () => {
    const same = {
      seed: "12345-0",
      look: { seed: "12345-0", attributes: { archetype: "bold", mode: "dark" } },
    };
    expect(isSameDesign(baseDraft, same)).toBe(true);

    const differentSeed = {
      seed: "99999-0",
      look: { seed: "99999-0", attributes: { archetype: "bold", mode: "dark" } },
    };
    expect(isSameDesign(baseDraft, differentSeed)).toBe(false);
  });

  it("returns LOCKED (disabled) when same design and photo counts are identical", () => {
    const state = getDesignSelectionState({
      draft: baseDraft,
      latestVersion: { versionNumber: 4, draft: baseDraft },
      currentPhotoCount: 215,
      savedPhotoCount: 215,
      optionIndex: 0,
    });
    expect(state.state).toBe("LOCKED");
    expect(state.isLocked).toBe(true);
    expect(state.label).toContain("Selected (Version 4)");
  });

  it("returns UPDATE_AVAILABLE (enabled) when same design but project has more photos than saved version", () => {
    const state = getDesignSelectionState({
      draft: baseDraft,
      latestVersion: { versionNumber: 4, draft: baseDraft },
      currentPhotoCount: 215,
      savedPhotoCount: 0, // Saved before photos!
      optionIndex: 0,
    });
    expect(state.state).toBe("UPDATE_AVAILABLE");
    expect(state.isLocked).toBe(false);
    expect(state.label).toBe("Save as Version 5 (includes newly uploaded photos)");
  });

  it("returns NEW_DESIGN (enabled) when drafts have different seeds (e.g. after Regenerate)", () => {
    const regeneratedDraft = {
      seed: "new-seed-0",
      look: { seed: "new-seed-0", attributes: { archetype: "bold" } },
    };
    const state = getDesignSelectionState({
      draft: regeneratedDraft,
      latestVersion: { versionNumber: 4, draft: baseDraft },
      currentPhotoCount: 215,
      savedPhotoCount: 215,
      optionIndex: 0,
    });
    expect(state.state).toBe("NEW_DESIGN");
    expect(state.isLocked).toBe(false);
    expect(state.label).toBe("Select Design Option 1");
  });

  it("handles missing/undefined photo counts safely without crashing", () => {
    const state = getDesignSelectionState({
      draft: baseDraft,
      latestVersion: { versionNumber: 1, draft: baseDraft },
      currentPhotoCount: undefined,
      savedPhotoCount: undefined,
      optionIndex: 1,
    });
    expect(state.state).toBe("LOCKED");
    expect(state.isLocked).toBe(true);
  });

  it("handles missing latestVersion safely without crashing", () => {
    const state = getDesignSelectionState({
      draft: baseDraft,
      latestVersion: null,
      optionIndex: 2,
    });
    expect(state.state).toBe("NEW_DESIGN");
    expect(state.isLocked).toBe(false);
    expect(state.label).toBe("Select Design Option 3");
  });
});
