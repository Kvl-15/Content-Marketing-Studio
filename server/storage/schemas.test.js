// @ts-check
import { describe, it, expect } from "vitest";
import { toPublicVersion, toPublicProject } from "./schemas.js";

describe("photoCount in public schemas (toPublicVersion & toPublicProject)", () => {
  it("counts only people with a truthy, non-empty photo string in toPublicVersion", () => {
    const version = {
      versionNumber: 2,
      draftIndex: 0,
      timestamp: "2026-10-21T12:00:00.000Z",
      draft: { id: "draft-1" },
      people: [
        { id: "P1", name: "Alice", photo: "attendee_001.jpg" },
        { id: "P2", name: "Bob", photo: null },
        { id: "P3", name: "Charlie", photo: "" },
        { id: "P4", name: "Dave", photo: "   " },
        { id: "P5", name: "Eve" }, // photo undefined
        { id: "P6", name: "Frank", photo: "attendee_006.png" },
      ],
    };

    const pub = toPublicVersion(version);
    expect(pub.peopleCount).toBe(6);
    expect(pub.photoCount).toBe(2); // Only P1 and P6
    expect(pub.people).toBeUndefined(); // Personal data stripped
  });

  it("returns photoCount: 0 when people is missing, null, or not an array in toPublicVersion", () => {
    expect(toPublicVersion({ versionNumber: 1, people: null }).photoCount).toBe(0);
    expect(toPublicVersion({ versionNumber: 1, people: undefined }).photoCount).toBe(0);
    expect(toPublicVersion({ versionNumber: 1, people: "invalid" }).photoCount).toBe(0);
    expect(toPublicVersion({ versionNumber: 1 }).photoCount).toBe(0);
  });

  it("handles legacy version without photo data and returns photoCount: 0", () => {
    const legacyVersion = {
      versionNumber: 1,
      draftIndex: 1,
      timestamp: "2026-10-20T10:00:00.000Z",
      people: [
        { id: "P1", name: "Alice", roleId: "participant", photo: null },
        { id: "P2", name: "Bob", roleId: "participant", photo: null },
      ],
    };

    const pub = toPublicVersion(legacyVersion);
    expect(pub.peopleCount).toBe(2);
    expect(pub.photoCount).toBe(0);
  });

  it("counts only people with a truthy, non-empty photo string in toPublicProject", () => {
    const project = {
      id: "proj_test_123",
      name: "Test Project",
      eventCode: "TEST26",
      eventSpec: { eventName: "Test" },
      people: [
        { id: "P1", photo: "photo1.jpg" },
        { id: "P2", photo: null },
        { id: "P3", photo: "photo3.webp" },
        { id: "P4", photo: "" },
      ],
      versions: [
        {
          versionNumber: 1,
          draftIndex: 0,
          people: [{ id: "P1", photo: null }],
        },
      ],
      createdAt: "2026-10-21T10:00:00.000Z",
      updatedAt: "2026-10-21T11:00:00.000Z",
    };

    const pub = toPublicProject(project);
    expect(pub.peopleCount).toBe(4);
    expect(pub.photoCount).toBe(2);
    expect(pub.people).toBeUndefined(); // Personal data stripped
    expect(pub.versions[0].peopleCount).toBe(1);
    expect(pub.versions[0].photoCount).toBe(0);
    expect(pub.versions[0].people).toBeUndefined(); // Nested personal data stripped
  });

  it("returns photoCount: 0 when project people is missing or empty in toPublicProject", () => {
    const emptyProj = {
      id: "proj_empty",
      name: "Empty",
      eventCode: "EMPTY",
      eventSpec: { eventName: "Empty" },
      people: [],
      createdAt: "2026-10-21T10:00:00.000Z",
      updatedAt: "2026-10-21T11:00:00.000Z",
    };
    const pub = toPublicProject(emptyProj);
    expect(pub.peopleCount).toBe(0);
    expect(pub.photoCount).toBe(0);
  });
});
