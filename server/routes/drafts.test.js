// @ts-check
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createDraftsRouter } from "./drafts.js";
import { createMemoryStorage } from "../storage/memory.js";
import { loadServerAssets } from "../assets.js";
import { ensureProjectPhotoDir, deleteProjectPhotoDir, toPublicProject } from "../storage/schemas.js";

/**
 * Lightweight in-memory request dispatcher for testing Express router handlers without network sockets.
 *
 * @param {import("express").Router} router
 * @param {{
 *   method: string;
 *   url: string;
 *   params?: Record<string, string>;
 *   body?: any;
 *   storage: any;
 *   assets: any;
 * }} options
 * @returns {Promise<{ status: number; body: any }>}
 */
function dispatch(router, options) {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    let responseBody = null;

    const req = {
      method: options.method,
      url: options.url,
      path: options.url,
      params: options.params || {},
      body: options.body || {},
      headers: { "content-type": "application/json" },
      app: {
        locals: {
          storage: options.storage,
          assets: options.assets,
        },
      },
    };

    const res = {
      status(code) {
        statusCode = code;
        return res;
      },
      json(data) {
        responseBody = data;
        resolve({ status: statusCode, body: responseBody });
        return res;
      },
      send(data) {
        responseBody = data;
        resolve({ status: statusCode, body: responseBody });
        return res;
      },
    };

    // @ts-ignore
    router.handle(req, res, (err) => {
      if (err) reject(err);
      else resolve({ status: 404, body: { error: "Not Handled" } });
    });
  });
}

describe("Task S & Slice 3: ID Card Draft Generation & Role Previews (server/routes/drafts.js)", () => {
  let storage;
  let assets;
  const router = createDraftsRouter();
  const createdProjectIds = [];

  beforeEach(async () => {
    storage = createMemoryStorage();
    assets = loadServerAssets();
  });

  afterEach(async () => {
    for (const id of createdProjectIds) {
      await deleteProjectPhotoDir(id);
    }
    createdProjectIds.length = 0;
  });

  const customRolesSpec = {
    schemaVersion: 1,
    designType: "id-card",
    event: {
      name: { value: "NIT Surat Hackathon 2026", status: "provided", source: "brief", confirmed: true },
      tagline: { value: "Innovate and build", status: "provided", source: "brief", confirmed: true },
      venue: { value: "SVNIT Campus", status: "provided", source: "brief", confirmed: true },
      dates: { value: ["2026-10-24"], status: "provided", source: "brief", confirmed: true },
      palette: ["#2563EB", "#16A34A"],
    },
    roles: [
      {
        id: "participant",
        label: "PARTICIPANT",
        expectedCount: 150,
        color: { value: "#2563EB", status: "provided", source: "brief", confirmed: true },
      },
      {
        id: "volunteer",
        label: "VOLUNTEER",
        expectedCount: 30,
        color: { value: "#16A34A", status: "provided", source: "brief", confirmed: true },
      },
      {
        id: "lead-organizer",
        label: "LEAD ORGANIZER",
        expectedCount: 10,
        color: { value: "#DC2626", status: "provided", source: "brief", confirmed: true },
      },
    ],
    fields: {
      value: ["name", "role", "id", "photo", "qr"],
      status: "provided",
      source: "brief",
      confirmed: true,
    },
    card: {
      widthMm: 54,
      heightMm: 85.6,
      orientation: "portrait",
      bleedMm: 3,
      safeMarginMm: 3,
      sides: "front",
    },
    qr: {
      enabled: true,
      urlPattern: "https://example.org/checkin/{{id}}",
    },
  };

  it("generates role-specific preview SVGs in draft.roleSvgs for all configured roles", async () => {
    const project = await storage.createProject({
      name: "NIT Surat Hackathon",
      eventCode: "NSH26",
      eventSpec: customRolesSpec,
    });
    createdProjectIds.push(project.id);

    // Add sample people for participant and volunteer roles
    await storage.addDatasetReport(project.id, {
      report: { totals: { rows: 2, ok: 2, warnings: 0, errors: 0 } },
      people: [
        {
          id: "NSH-P-001",
          name: "Aarav Mehta",
          roleId: "participant",
          org: "SVNIT",
          email: "aarav@example.com",
          photo: null,
        },
        {
          id: "NSH-V-001",
          name: "Diya Sharma",
          roleId: "volunteer",
          org: "SVNIT",
          email: "diya@example.com",
          photo: null,
        },
      ],
    });

    const res = await dispatch(router, {
      method: "POST",
      url: `/projects/${project.id}/drafts`,
      params: { id: project.id },
      body: { count: 3, seed: "test-seed-1" },
      storage,
      assets,
    });

    expect(res.status).toBe(200);
    expect(res.body.drafts).toHaveLength(3);

    for (const draft of res.body.drafts) {
      expect(draft.svg).toBeDefined();
      expect(draft.svg).toContain("<svg");
      expect(draft.roleSvgs).toBeDefined();

      // Check all 3 roles are present in roleSvgs
      expect(draft.roleSvgs["participant"]).toBeDefined();
      expect(draft.roleSvgs["volunteer"]).toBeDefined();
      expect(draft.roleSvgs["lead-organizer"]).toBeDefined();

      expect(draft.roleSvgs["participant"]).toContain("<svg");
      expect(draft.roleSvgs["volunteer"]).toContain("<svg");
      expect(draft.roleSvgs["lead-organizer"]).toContain("<svg");

      // Verify the variants differ per role (different labels, colors, and markers)
      expect(draft.roleSvgs["lead-organizer"]).not.toEqual(draft.roleSvgs["participant"]);
      expect(draft.roleSvgs["volunteer"]).not.toEqual(draft.roleSvgs["participant"]);
    }

    // Verify persistence in storage
    const reloaded = await storage.getProject(project.id);
    expect(reloaded.currentDrafts).toHaveLength(3);
    expect(reloaded.currentDrafts[0].roleSvgs["participant"]).toBeDefined();

    // Verify public project does not expose raw people
    const publicProj = toPublicProject(reloaded);
    expect(publicProj.people).toBeUndefined();
    expect(publicProj.peopleCount).toBe(2);
    expect(publicProj.currentDrafts).toBeDefined();
  }, 20000);

  it("embeds real matched photo as base64 data URI and protects filesystem privacy", async () => {
    const project = await storage.createProject({
      name: "NIT Surat Hackathon",
      eventCode: "NSH26",
      eventSpec: customRolesSpec,
    });
    createdProjectIds.push(project.id);

    // Create a real 100x100 JPEG photo on disk in the project photo directory
    const photoDir = await ensureProjectPhotoDir(project.id);
    const photoFilename = "NSH-P-001.jpg";
    const photoFilePath = path.join(photoDir, photoFilename);
    const jpegBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 37, g: 99, b: 235 },
      },
    })
      .jpeg()
      .toBuffer();

    await fs.writeFile(photoFilePath, jpegBuffer);

    // Add attendee record pointing to the matched photo
    await storage.addDatasetReport(project.id, {
      report: { totals: { rows: 1, ok: 1, warnings: 0, errors: 0 } },
      people: [
        {
          id: "NSH-P-001",
          name: "Aarav Mehta",
          roleId: "participant",
          org: "SVNIT",
          email: "aarav@example.com",
          photo: photoFilename,
        },
      ],
    });

    const res = await dispatch(router, {
      method: "POST",
      url: `/projects/${project.id}/drafts`,
      params: { id: project.id },
      body: { count: 3, seed: "photo-test-seed" },
      storage,
      assets,
    });

    expect(res.status).toBe(200);
    const firstDraft = res.body.drafts[0];

    // Card preview SVG should contain embedded base64 data URI image for attendee photo
    const participantSvg = firstDraft.roleSvgs["participant"];
    expect(participantSvg).toContain('id="photo"');
    expect(participantSvg).toMatch(/<g id="photo"[^>]*>[\s\S]*?<image[^>]*href="data:image\/jpeg;base64,/);

    // Privacy rule check: local disk path MUST NOT be in the SVG
    expect(participantSvg).not.toContain(photoDir);
    expect(participantSvg).not.toContain(photoFilePath);
    expect(participantSvg).not.toContain("acm-studio");

    // Privacy rule check: response body must not leak participant email
    const responseJsonStr = JSON.stringify(res.body);
    expect(responseJsonStr).not.toContain("aarav@example.com");
  }, 20000);

  it("renders clean fallback initials avatar when attendee has no photo", async () => {
    const project = await storage.createProject({
      name: "NIT Surat Hackathon",
      eventCode: "NSH26",
      eventSpec: customRolesSpec,
    });
    createdProjectIds.push(project.id);

    // Add attendee without photo
    await storage.addDatasetReport(project.id, {
      report: { totals: { rows: 1, ok: 1, warnings: 0, errors: 0 } },
      people: [
        {
          id: "NSH-P-002",
          name: "Rohan Patel",
          roleId: "participant",
          org: "SVNIT",
          email: "rohan@example.com",
          photo: null,
        },
      ],
    });

    const res = await dispatch(router, {
      method: "POST",
      url: `/projects/${project.id}/drafts`,
      params: { id: project.id },
      body: { count: 3, seed: "no-photo-seed" },
      storage,
      assets,
    });

    expect(res.status).toBe(200);
    const participantSvg = res.body.drafts[0].roleSvgs["participant"];

    // Should NOT have an <image id="photo" since photo was not provided
    expect(participantSvg).not.toMatch(/<image[^>]*id="photo"/);
    // Should render SVG correctly with initials avatar
    expect(participantSvg).toContain("<svg");
  }, 20000);

  it("returns 404 for non-existent project", async () => {
    const res = await dispatch(router, {
      method: "POST",
      url: "/projects/non_existent_id/drafts",
      params: { id: "non_existent_id" },
      body: { count: 3 },
      storage,
      assets,
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("generates drafts with zero UNKNOWN_ROLE_ID errors when eventSpec has custom roles like 'participants' and 'mentors'", async () => {
    const pluralRolesSpec = {
      ...customRolesSpec,
      roles: [
        {
          id: "participants",
          label: "Participants",
          color: { value: "#2563EB", status: "provided", source: "brief", confirmed: true },
          expectedCount: 150,
        },
        {
          id: "mentors",
          label: "Mentors",
          color: { value: "#10B981", status: "provided", source: "brief", confirmed: true },
          expectedCount: 20,
        },
      ],
    };

    const project = await storage.createProject({
      name: "NIT Surat Hackathon Plural",
      eventCode: "NSH26",
      eventSpec: pluralRolesSpec,
    });
    createdProjectIds.push(project.id);

    const res = await dispatch(router, {
      method: "POST",
      url: `/projects/${project.id}/drafts`,
      params: { id: project.id },
      body: { count: 3, seed: "plural-seed" },
      storage,
      assets,
    });

    expect(res.status).toBe(200);
    expect(res.body.drafts).toHaveLength(3);

    // Verify roleSvgs has keys for participants and mentors
    expect(res.body.drafts[0].roleSvgs).toHaveProperty("participants");
    expect(res.body.drafts[0].roleSvgs).toHaveProperty("mentors");

    // Verify zero UNKNOWN_ROLE_ID errors in result issues or draft issues
    const resultRoleErrors = (res.body.issues || []).filter((i) => i.code === "UNKNOWN_ROLE_ID");
    expect(resultRoleErrors).toHaveLength(0);

    for (const draft of res.body.drafts) {
      const draftRoleErrors = (draft.issues || []).filter((i) => i.code === "UNKNOWN_ROLE_ID");
      expect(draftRoleErrors).toHaveLength(0);
    }
  }, 20000);
});
