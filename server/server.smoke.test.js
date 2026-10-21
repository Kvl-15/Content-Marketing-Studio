// @ts-check
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "./app.js";
import { createMemoryStorage } from "./storage/memory.js";
import { sampleEventSpec } from "../core/fixtures.js";
import { activeProjectExports } from "./routes/export.js";

describe("Server HTTP API smoke tests", { timeout: 30000 }, () => {
  let app;
  let server;
  let baseUrl;
  let storage;

  beforeAll(async () => {
    storage = createMemoryStorage();
    app = await createApp({ storage });

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        baseUrl = `http://localhost:${addr.port}`;
        resolve(null);
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("GET /health returns 200 with status ok and storage type", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", storage: "memory" });
  });

  it("GET /health returns 503 error when database ping fails", async () => {
    const failingStorage = {
      type: "mongo",
      ping: async () => false,
    };
    const brokenApp = await createApp({ storage: failingStorage });
    const srv = brokenApp.listen(0);
    const brokenUrl = `http://localhost:${srv.address().port}`;
    try {
      const res = await fetch(`${brokenUrl}/health`);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body).toEqual({ status: "error", storage: "mongo" });
    } finally {
      await new Promise((resolve) => srv.close(resolve));
    }
  });

  it("completes the full happy path: create project -> CSV data -> drafts -> version -> sheet & card exports", async () => {
    // 1. Create project
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "NIT Surat Hackathon 2026",
        eventSpec: sampleEventSpec,
      }),
    });
    expect(createRes.status).toBe(201);
    const project = await createRes.json();
    expect(project.id).toMatch(/^proj_/);
    expect(project.eventCode).toMatch(/^[A-Z0-9]{2,8}$/);
    expect(project.people).toBeUndefined();
    expect(project.peopleCount).toBe(0);
    const projectId = project.id;

    // 2. Upload CSV data (2 valid rows)
    const csvContent =
      "Full Name,Role,Organization,Email\n" +
      "Aarav Mehta,participant,SVNIT,aarav@example.com\n" +
      "Priya Sharma,mentor,Google,priya@example.com\n";

    const dataRes = await fetch(`${baseUrl}/projects/${projectId}/data?kind=csv`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: csvContent,
    });
    expect(dataRes.status).toBe(200);
    const dataBody = await dataRes.json();
    expect(dataBody.report).toBeDefined();
    expect(dataBody.report.totals.rows).toBe(2);
    expect(dataBody.report.totals.errors).toBe(0);
    // Personal privacy assertion: people array not returned to client
    expect(dataBody.people).toBeUndefined();

    const firstPersonId = dataBody.report.rows[0].id;
    expect(firstPersonId).toBeDefined();

    // 3. Compose drafts
    const draftsRes = await fetch(`${baseUrl}/projects/${projectId}/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 3 }),
    });
    expect(draftsRes.status).toBe(200);
    const draftsBody = await draftsRes.json();
    expect(draftsBody.drafts).toHaveLength(3);
    for (const draft of draftsBody.drafts) {
      expect(draft.svg).toBeDefined();
      expect(draft.svg).toContain("<svg");
    }

    // 4. Save version
    const versionRes = await fetch(`${baseUrl}/projects/${projectId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftIndex: 0, note: "Initial release" }),
    });
    expect(versionRes.status).toBe(201);
    const versionBody = await versionRes.json();
    expect(versionBody.versionNumber).toBe(1);
    expect(versionBody.draftIndex).toBe(0);
    // Personal privacy assertion: people array not in version response, peopleCount provided
    expect(versionBody.people).toBeUndefined();
    expect(versionBody.peopleCount).toBe(2);

    // 5. Verify GET /projects/:id and GET /projects/:id/versions contain NO participant names or emails
    const getProjRes = await fetch(`${baseUrl}/projects/${projectId}`);
    expect(getProjRes.status).toBe(200);
    const getProjBody = await getProjRes.json();
    expect(getProjBody.people).toBeUndefined();
    expect(getProjBody.peopleCount).toBe(2);
    const getProjStr = JSON.stringify(getProjBody);
    expect(getProjStr).not.toContain("Aarav");
    expect(getProjStr).not.toContain("Priya");
    expect(getProjStr).not.toContain("aarav@example.com");
    expect(getProjStr).not.toContain("priya@example.com");

    const getVersRes = await fetch(`${baseUrl}/projects/${projectId}/versions`);
    expect(getVersRes.status).toBe(200);
    const getVersBody = await getVersRes.json();
    expect(getVersBody[0].people).toBeUndefined();
    expect(getVersBody[0].peopleCount).toBe(2);
    const getVersStr = JSON.stringify(getVersBody);
    expect(getVersStr).not.toContain("Aarav");
    expect(getVersStr).not.toContain("Priya");
    expect(getVersStr).not.toContain("aarav@example.com");
    expect(getVersStr).not.toContain("priya@example.com");

    // 6. Export A4 sheet SVG (format: "svg", zero browser launch)
    const sheetRes = await fetch(`${baseUrl}/projects/${projectId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "sheet",
        format: "svg",
        acknowledgedWarnings: true,
      }),
    });
    expect(sheetRes.status).toBe(200);
    expect(sheetRes.headers.get("content-type")).toContain("image/svg+xml");
    const sheetSvg = await sheetRes.text();
    expect(sheetSvg).toContain("<svg");

    // 7. Export single card SVG
    const cardSvgRes = await fetch(`${baseUrl}/projects/${projectId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "card",
        personId: firstPersonId,
        format: "svg",
        acknowledgedWarnings: true,
      }),
    });
    expect(cardSvgRes.status).toBe(200);
    expect(cardSvgRes.headers.get("content-type")).toContain("image/svg+xml");
    const cardSvgText = await cardSvgRes.text();
    expect(cardSvgText).toContain("<svg");

    // 8. Export single card PNG (rasterized with sharp, zero browser launch)
    const cardPngRes = await fetch(`${baseUrl}/projects/${projectId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "card",
        personId: firstPersonId,
        format: "png",
        acknowledgedWarnings: true,
      }),
    });
    expect(cardPngRes.status).toBe(200);
    expect(cardPngRes.headers.get("content-type")).toBe("image/png");
    const cardPngBytes = await cardPngRes.arrayBuffer();
    expect(cardPngBytes.byteLength).toBeGreaterThan(1000);

    // 9. Export batch ZIP (SVG format, zero browser launch)
    const zipRes = await fetch(`${baseUrl}/projects/${projectId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "zip",
        format: "svg",
        acknowledgedWarnings: true,
      }),
    });
    expect(zipRes.status).toBe(200);
    expect(zipRes.headers.get("content-type")).toBe("application/zip");
    const zipBytes = await zipRes.arrayBuffer();
    expect(zipBytes.byteLength).toBeGreaterThan(200);
  });

  it("returns 200 with report when some rows have errors, excluding error rows from stored people", async () => {
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Partial Error Project",
        eventSpec: sampleEventSpec,
      }),
    });
    const project = await createRes.json();

    // 1 valid row + 1 invalid role row
    const mixedCsv =
      "Full Name,Role,Email\n" +
      "Valid Person,participant,valid@example.com\n" +
      "Invalid Person,unknownrole123,invalid@example.com\n";

    const dataRes = await fetch(`${baseUrl}/projects/${project.id}/data`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: mixedCsv,
    });

    expect(dataRes.status).toBe(200);
    const body = await dataRes.json();
    expect(body.report).toBeDefined();
    expect(body.report.totals.rows).toBe(2);
    expect(body.report.totals.errors).toBe(1);
    expect(body.report.totals.warnings).toBe(1);

    // Check project peopleCount is 1 (the invalid row was excluded)
    const projRes = await fetch(`${baseUrl}/projects/${project.id}`);
    const projBody = await projRes.json();
    expect(projBody.peopleCount).toBe(1);
  });

  it("returns 422 with report when zero valid people remain in uploaded CSV data", async () => {
    // 1. Create project
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Zero Valid Project",
        eventSpec: sampleEventSpec,
      }),
    });
    const project = await createRes.json();

    // 2. Upload CSV where all rows have invalid roles
    const csvContent =
      "Full Name,Role,Email\n" +
      "Test User 1,superadmin,test1@example.com\n" +
      "Test User 2,fake_role,test2@example.com\n";

    const dataRes = await fetch(`${baseUrl}/projects/${project.id}/data`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: csvContent,
    });

    expect(dataRes.status).toBe(422);
    const errorBody = await dataRes.json();
    expect(errorBody.error).toBeDefined();
    expect(errorBody.error.code).toBe("UNKNOWN_ROLE_ID");
    expect(errorBody.error.issues).toBeDefined();
    expect(errorBody.error.issues.length).toBe(2);
    // Report is still delivered to client in 422 response
    expect(errorBody.report).toBeDefined();
    expect(errorBody.report.totals.errors).toBe(2);
  });

  it("imports CSV with name, role, participant_id successfully with HTTP 200 instead of 422", async () => {
    // 1. Create project
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Participant ID CSV Project",
        eventSpec: sampleEventSpec,
      }),
    });
    const project = await createRes.json();

    // Verify photo upload is initially gated before tabular data
    const prePhotoRes = await fetch(`${baseUrl}/projects/${project.id}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: Buffer.from([0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    });
    expect(prePhotoRes.status).toBe(400);
    const prePhotoBody = await prePhotoRes.json();
    expect(prePhotoBody.error.code).toBe("NO_DATASET");

    // 2. Upload CSV with headers: name, role, participant_id
    const csvContent =
      "name,role,participant_id\n" +
      "Alice Smith,participant,P-101\n" +
      "Bob Jones,participant,P-102\n" +
      "Carol White,participant,P-103\n" +
      "David Black,mentor,P-104\n" +
      "Eve Green,participant,P-105\n";

    const dataRes = await fetch(`${baseUrl}/projects/${project.id}/data`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: csvContent,
    });

    expect(dataRes.status).toBe(200);
    const body = await dataRes.json();
    expect(body.report).toBeDefined();
    expect(body.report.totals.rows).toBe(5);
    expect(body.report.totals.errors).toBe(0);
    expect(body.report.totals.warnings).toBe(5);
    expect(body.report.mapping.mapping).toEqual({ name: 0, roleId: 1, id: 2 });
    expect(body.report.mapping.competing).toEqual({});

    // Verify project has 5 attendees and saved datasetReport when retrieved via GET /projects/:id
    const projRes = await fetch(`${baseUrl}/projects/${project.id}`);
    const projBody = await projRes.json();
    expect(projBody.peopleCount).toBe(5);
    expect(projBody.datasetReport).toBeDefined();
    expect(projBody.datasetReport.totals.rows).toBe(5);
    expect(projBody.datasetReport.totals.errors).toBe(0);
  });

  it("returns 404 for an unknown project ID", async () => {
    const res = await fetch(`${baseUrl}/projects/proj_non_existent_12345`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 413 for a too-large body", async () => {
    // 1MB is json limit; send 1.5MB JSON
    const largeName = "A".repeat(1.5 * 1024 * 1024);
    const res = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: largeName, eventSpec: sampleEventSpec }),
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("returns 400 for a bad EventSpec", async () => {
    const res = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bad Event",
        eventSpec: { schemaVersion: 2, invalidField: true },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_EVENT_SPEC");
  });

  it("guarantees privacy: logs and error bodies contain NO name or email from uploaded CSV", async () => {
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Privacy Guard Event",
        eventSpec: sampleEventSpec,
      }),
    });
    const project = await createRes.json();

    const privateName = "SuperConfidentialNameXYZ";
    const privateEmail = "secret_identity_123@svnit.ac.in";

    // Capture stdout/console during upload
    const logs = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args) => {
      logs.push(args.join(" "));
      origLog(...args);
    };
    console.error = (...args) => {
      logs.push(args.join(" "));
      origError(...args);
    };

    let dataRes;
    try {
      // Trigger an error with unknown role while supplying private name & email
      const badCsv = `Full Name,Role,Email\n${privateName},NonExistentRole,${privateEmail}\n`;
      dataRes = await fetch(`${baseUrl}/projects/${project.id}/data`, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: badCsv,
      });
    } finally {
      console.log = origLog;
      console.error = origError;
    }

    expect(dataRes.status).toBe(422);
    const errorBodyText = await dataRes.text();
    const joinedLogs = logs.join("\n");

    // Assert name and email are nowhere in error body
    expect(errorBodyText).not.toContain(privateName);
    expect(errorBodyText).not.toContain(privateEmail);

    // Assert name and email are nowhere in logs
    expect(joinedLogs).not.toContain(privateName);
    expect(joinedLogs).not.toContain(privateEmail);
  });

  it("enforces D-09 preflight gating: corrupt draft or unacknowledged warning is rejected with 422", async () => {
    // 1. Create project
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Preflight Gate Event",
        eventSpec: sampleEventSpec,
      }),
    });
    const project = await createRes.json();

    // 2. Upload CSV (valid row without photo)
    const csvContent = "Full Name,Role,Email\nJohn Doe,participant,john@example.com\n";
    await fetch(`${baseUrl}/projects/${project.id}/data`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: csvContent,
    });

    // 3. Compose drafts
    await fetch(`${baseUrl}/projects/${project.id}/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 1 }),
    });

    // 4. Save version
    await fetch(`${baseUrl}/projects/${project.id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftIndex: 0 }),
    });

    // 5. Attempt export WITHOUT acknowledging warnings (person has NO_PHOTO warning)
    const exportRes = await fetch(`${baseUrl}/projects/${project.id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "sheet",
        format: "svg",
        acknowledgedWarnings: false, // D-09 requires warnings to be acknowledged
      }),
    });

    expect(exportRes.status).toBe(422);
    const errorBody = await exportRes.json();
    expect(errorBody.error).toBeDefined();
    expect(errorBody.error.message).toContain("D-09");
    expect(errorBody.error.issues).toBeDefined();
    expect(errorBody.error.issues.length).toBeGreaterThan(0);
  });

  it("enforces orientation and sides constraints (Condition 2)", async () => {
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Orientation Test",
        eventSpec: sampleEventSpec,
      }),
    });
    const project = await createRes.json();

    // Landscape rejection
    const landscapeRes = await fetch(`${baseUrl}/projects/${project.id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "sheet",
        orientation: "landscape",
      }),
    });
    expect(landscapeRes.status).toBe(422);
    const landscapeBody = await landscapeRes.json();
    expect(landscapeBody.error.code).toBe("UNSUPPORTED_ORIENTATION");

    // Sides back rejection
    const sidesRes = await fetch(`${baseUrl}/projects/${project.id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "sheet",
        sides: "back",
      }),
    });
    expect(sidesRes.status).toBe(422);
    const sidesBody = await sidesRes.json();
    expect(sidesBody.error.code).toBe("UNSUPPORTED_SIDES");
  });

  it("returns 409 when an export is already active on the same project (Condition 4)", async () => {
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Concurrency Test",
        eventSpec: sampleEventSpec,
      }),
    });
    const project = await createRes.json();

    // Simulate an in-progress export on this project using activeProjectExports set
    activeProjectExports.add(project.id);
    try {
      const res = await fetch(`${baseUrl}/projects/${project.id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "card",
          format: "svg",
          acknowledgedWarnings: true,
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("EXPORT_IN_PROGRESS");
    } finally {
      activeProjectExports.delete(project.id);
    }
  });

  it("handles custom role IDs ('participants' and 'mentors') end-to-end: imports CSV, saves version with zero synthetic role errors, exports successfully, and enforces D-09 gate on invalid roles", async () => {
    const customRolesSpec = {
      ...sampleEventSpec,
      roles: [
        {
          id: "participants",
          label: "PARTICIPANTS",
          expectedCount: 200,
          color: { value: "#2563EB", status: "defaulted", source: "default" },
        },
        {
          id: "mentors",
          label: "MENTORS",
          expectedCount: 20,
          color: { value: "#10B981", status: "defaulted", source: "default" },
        },
      ],
    };

    // 1. Create project with custom roles
    const createRes = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Custom Roles Studio Hackathon",
        eventSpec: customRolesSpec,
      }),
    });
    expect(createRes.status).toBe(201);
    const project = await createRes.json();
    const projectId = project.id;

    // 2. Import CSV with 'participants' and 'mentors'
    const csvContent =
      "name,role,organization\n" +
      "Dev User,participants,ACM Chapter\n" +
      "Mentor Lead,mentors,ACM Chapter\n";

    const dataRes = await fetch(`${baseUrl}/projects/${projectId}/data`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: csvContent,
    });
    expect(dataRes.status).toBe(200);
    const dataBody = await dataRes.json();
    expect(dataBody.report.totals.rows).toBe(2);
    expect(dataBody.report.totals.errors).toBe(0);

    // 3. Generate drafts
    const draftsRes = await fetch(`${baseUrl}/projects/${projectId}/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 3 }),
    });
    expect(draftsRes.status).toBe(200);
    const draftsBody = await draftsRes.json();
    const draftIssues = draftsBody.issues || [];
    const unknownRoleErrors = draftIssues.filter((i) => i.code === "UNKNOWN_ROLE_ID");
    expect(unknownRoleErrors).toHaveLength(0);

    // 4. Save Version
    const versionRes = await fetch(`${baseUrl}/projects/${projectId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftIndex: 0, note: "Selection v1" }),
    });
    expect(versionRes.status).toBe(201);
    const versionBody = await versionRes.json();
    const versionDraftIssues = versionBody.draft?.issues || [];
    expect(versionDraftIssues.filter((i) => i.code === "UNKNOWN_ROLE_ID")).toHaveLength(0);

    // 5. Verify GET /projects/:id and GET /projects/:id/versions have 0 UNKNOWN_ROLE_ID errors
    const getProjRes = await fetch(`${baseUrl}/projects/${projectId}`);
    expect(getProjRes.status).toBe(200);
    const getProjBody = await getProjRes.json();
    const projVersions = getProjBody.versions || [];
    expect(projVersions).toHaveLength(1);
    expect(
      (projVersions[0].draft?.issues || []).filter((i) => i.code === "UNKNOWN_ROLE_ID")
    ).toHaveLength(0);

    // 6. Execute Print Sheet Export (D-09 gate passes)
    const exportRes = await fetch(`${baseUrl}/projects/${projectId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "sheet",
        format: "pdf",
        paper: "A4",
        acknowledgedWarnings: true,
      }),
    });
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get("Content-Type")).toBe("application/pdf");
    const exportBytes = await exportRes.arrayBuffer();
    expect(exportBytes.byteLength).toBeGreaterThan(100);

    // 7. Verify invalid role like 'boss' is rejected by CSV intake with 422 UNKNOWN_ROLE_ID
    const badCsvRes = await fetch(`${baseUrl}/projects/${projectId}/data`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: "name,role,organization\nBad Actor,boss,ACM Chapter\n",
    });
    expect(badCsvRes.status).toBe(422);
    const badBody = await badCsvRes.json();
    expect(badBody.error.code).toBe("UNKNOWN_ROLE_ID");

    // 8. Test public projection: verify GET /projects/:id sanitizes synthetic issues without mutating storage
    const getPublicProjRes = await fetch(`${baseUrl}/projects/${projectId}`);
    const publicProj = await getPublicProjRes.json();
    const lingeringSynthetic = (publicProj.versions[0].draft?.issues || []).filter(
      (i) => i.code === "UNKNOWN_ROLE_ID"
    );
    expect(lingeringSynthetic).toHaveLength(0);
  });

  it("attaches photos via POST /projects/:id/photos in bulk storage write and proves saved versions remain immutable", async () => {
    // 1. Create project with sample event spec
    const projRes = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Photo Bulk Attachment & Immutability Test",
        eventSpec: sampleEventSpec,
      }),
    });
    const proj = await projRes.json();
    const pid = proj.id;

    // 2. Upload CSV with 2 attendees
    const csvContent = "name,role,organization,email\nAlice Smith,participant,ACM Chapter,alice@example.com\nBob Jones,organizer,ACM Chapter,bob@example.com\n";
    const dataRes = await fetch(`${baseUrl}/projects/${pid}/data`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: csvContent,
    });
    expect(dataRes.status).toBe(200);
    const dataBody = await dataRes.json();
    const attendee1 = dataBody.report.rows[0].id;
    const attendee2 = dataBody.report.rows[1].id;

    // 3. Generate drafts & save version 1 BEFORE photos are uploaded
    await fetch(`${baseUrl}/projects/${pid}/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count: 1 }),
    });

    const v1Res = await fetch(`${baseUrl}/projects/${pid}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftIndex: 0, note: "Version before photos" }),
    });
    expect(v1Res.status).toBe(201);

    // Verify version 1 in storage has NO photos attached to people
    const storedProjBefore = await storage.getProject(pid);
    expect(storedProjBefore.versions).toHaveLength(1);
    const v1PeopleBefore = storedProjBefore.versions[0].people;
    expect(v1PeopleBefore[0].photo).toBeFalsy();
    expect(v1PeopleBefore[1].photo).toBeFalsy();

    // 4. Build ZIP with 2 attendee photos + README.txt
    const sharp = (await import("sharp")).default;
    const validPng = await sharp({
      create: { width: 40, height: 40, channels: 3, background: { r: 50, g: 150, b: 250 } },
    }).png().toBuffer();

    const { deflateRawSync } = await import("node:zlib");
    function buildZip(entries) {
      const table = (() => { const t = []; for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : c >>> 1; t[n] = c >>> 0; } return t; })();
      const crc32 = (data) => { let c = 0xffffffff; for (const byte of data) c = table[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
      const locals = []; const centrals = []; let offset = 0;
      for (const entry of entries) {
        const name = Buffer.from(entry.name); const body = entry.compress ? deflateRawSync(entry.data) : entry.data;
        const local = Buffer.alloc(30 + name.length); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
        local.writeUInt16LE(entry.compress ? 8 : 0, 8); local.writeUInt32LE(crc32(entry.data), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(entry.data.length, 22);
        local.writeUInt16LE(name.length, 26); name.copy(local, 30); locals.push(Buffer.concat([local, body]));
        const central = Buffer.alloc(46 + name.length); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
        central.writeUInt16LE(entry.compress ? 8 : 0, 10); central.writeUInt32LE(crc32(entry.data), 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(entry.data.length, 24);
        central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42); name.copy(central, 46); centrals.push(central); offset += local.length + body.length;
      }
      const central = Buffer.concat(centrals); const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(offset, 16);
      return Buffer.concat([...locals, central, eocd]);
    }

    const zipBuffer = buildZip([
      { name: `${attendee1}.png`, data: validPng, compress: false },
      { name: "bob@example.com.png", data: validPng, compress: false },
      { name: "README.txt", data: Buffer.from("Harmless non-image readme note"), compress: false },
    ]);

    // 5. Upload photo ZIP
    const photoUploadRes = await fetch(`${baseUrl}/projects/${pid}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: zipBuffer,
    });
    expect(photoUploadRes.status).toBe(200);
    const photoBody = await photoUploadRes.json();
    expect(photoBody.matches).toHaveLength(2);
    expect(photoBody.unmatchedFiles).toHaveLength(0);
    expect(photoBody.warnings).toHaveLength(0);
    expect(photoBody.ignoredFiles).toEqual([
      { file: "README.txt", reason: "Harmless non-image text file" },
    ]);

    // 6. Verify people in current project storage have photos attached
    const storedProjAfter = await storage.getProject(pid);
    const person1 = storedProjAfter.people.find((p) => p.id === attendee1);
    const person2 = storedProjAfter.people.find((p) => p.id === attendee2);
    expect(person1.photo).toBe(`${attendee1}.jpg`);
    expect(person2.photo).toBe(`${attendee2}.jpg`);
    expect(person1.flags.includes("NO_PHOTO")).toBe(false);
    expect(person2.flags.includes("NO_PHOTO")).toBe(false);

    // 7. PROVE IMMUTABILITY: Verify saved version 1 snapshot was NOT modified
    expect(storedProjAfter.versions).toHaveLength(1);
    const v1PeopleAfter = storedProjAfter.versions[0].people;
    expect(v1PeopleAfter[0].photo).toBeFalsy();
    expect(v1PeopleAfter[1].photo).toBeFalsy();
    expect(storedProjAfter.versions[0].timestamp).toBe(storedProjBefore.versions[0].timestamp);
    expect(storedProjAfter.versions[0].note).toBe("Version before photos");
  });

  it("sanitizer safety: strictly purges 4-point synthetic stress issues and preserves genuine validation errors", async () => {
    const { isSyntheticStressRoleIssue, sanitizeSyntheticRoleIssues } = await import("./storage/schemas.js");

    const currentPeople = [
      { id: "REAL-ATTENDEE-001", name: "Alice", roleId: "participant" },
      { id: "HX26-S-001", name: "Real Attendee with Stress ID", roleId: "participant" },
    ];

    // Case 1: Real synthetic issue (ALL 4 conditions hold):
    // UNKNOWN_ROLE_ID + HX26-S-002 (not in currentPeople) + role 'participant'
    const syntheticIssue = {
      severity: "error",
      code: "UNKNOWN_ROLE_ID",
      nodeId: "role",
      message: 'Person "HX26-S-002" has invalid or unrecognised roleId "participant"; must match an id in event.roles',
    };
    expect(isSyntheticStressRoleIssue(syntheticIssue, currentPeople)).toBe(true);
    expect(sanitizeSyntheticRoleIssues([syntheticIssue], currentPeople)).toHaveLength(0);

    // Case 2: Person ID is "boss" -> MUST BE KEPT!
    const bossIssue = {
      severity: "error",
      code: "UNKNOWN_ROLE_ID",
      nodeId: "role",
      message: 'Person "boss" has invalid or unrecognised roleId "participant"; must match an id in event.roles',
    };
    expect(isSyntheticStressRoleIssue(bossIssue, currentPeople)).toBe(false);
    expect(sanitizeSyntheticRoleIssues([bossIssue], currentPeople)).toHaveLength(1);

    // Case 3: Empty role -> MUST BE KEPT!
    const emptyRoleIssue = {
      severity: "error",
      code: "UNKNOWN_ROLE_ID",
      nodeId: "role",
      message: 'Person "HX26-S-003" has invalid or unrecognised roleId ""; must match an id in event.roles',
    };
    expect(isSyntheticStressRoleIssue(emptyRoleIssue, currentPeople)).toBe(false);
    expect(sanitizeSyntheticRoleIssues([emptyRoleIssue], currentPeople)).toHaveLength(1);

    // Case 4: Person ID is in currentPeople (real attendee named HX26-S-001) -> MUST BE KEPT!
    const realAttendeeIssue = {
      severity: "error",
      code: "UNKNOWN_ROLE_ID",
      nodeId: "role",
      message: 'Person "HX26-S-001" has invalid or unrecognised roleId "participant"; must match an id in event.roles',
    };
    expect(isSyntheticStressRoleIssue(realAttendeeIssue, currentPeople)).toBe(false);
    expect(sanitizeSyntheticRoleIssues([realAttendeeIssue], currentPeople)).toHaveLength(1);

    // Case 5: Role is "speaker" (not participant/organizer) -> MUST BE KEPT!
    const speakerIssue = {
      severity: "error",
      code: "UNKNOWN_ROLE_ID",
      nodeId: "role",
      message: 'Person "HX26-S-004" has invalid or unrecognised roleId "speaker"; must match an id in event.roles',
    };
    expect(isSyntheticStressRoleIssue(speakerIssue, currentPeople)).toBe(false);
    expect(sanitizeSyntheticRoleIssues([speakerIssue], currentPeople)).toHaveLength(1);

    // Case 6: Issue code is NOT UNKNOWN_ROLE_ID -> MUST BE KEPT!
    const otherCodeIssue = {
      severity: "error",
      code: "TEXT_OVERFLOW",
      nodeId: "name",
      message: 'Text overflow for person "HX26-S-005"',
    };
    expect(isSyntheticStressRoleIssue(otherCodeIssue, currentPeople)).toBe(false);
    expect(sanitizeSyntheticRoleIssues([otherCodeIssue], currentPeople)).toHaveLength(1);

    // Case 7: Names containing 'dry-run' or 'PREVIEW-' with non-stress IDs -> MUST BE KEPT!
    const dryRunIssue = {
      severity: "error",
      code: "UNKNOWN_ROLE_ID",
      nodeId: "role",
      message: 'Person "dry-run-user" has invalid or unrecognised roleId "participant"; must match an id in event.roles',
    };
    expect(isSyntheticStressRoleIssue(dryRunIssue, currentPeople)).toBe(false);
    expect(sanitizeSyntheticRoleIssues([dryRunIssue], currentPeople)).toHaveLength(1);
  });

  it("verifies getProject(id) is strictly read-only in storage with zero writes", async () => {
    const created = await storage.createProject({
      name: "Read-Only Storage Verification",
      eventSpec: sampleEventSpec,
    });
    const projId = created.id;

    const read1 = await storage.getProject(projId);
    expect(read1).toBeDefined();

    // Verify Mongo getProject implementation is also strictly read-only by code inspection
    const { createMongoStorage } = await import("./storage/mongo.js");
    const mongoCode = createMongoStorage.toString();
    expect(mongoCode.includes("updateOne")).toBe(false);
    expect(mongoCode.includes("$unset")).toBe(false);
  });

  describe("Sanitizer & Export Gating Verification (Requirements 2a - 2f)", () => {
    it("(a) proves export blockers come from CURRENT attendees and not from stale draft.issues in a saved version", async () => {
      const projRes = await fetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test 2a Current Attendees Gating",
          eventSpec: sampleEventSpec,
        }),
      });
      const proj = await projRes.json();
      const pid = proj.id;

      // Ingest valid CSV
      await fetch(`${baseUrl}/projects/${pid}/data`, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: "name,role,organization\nValid Person,participant,ACM\n",
      });

      // Generate drafts & save version
      await fetch(`${baseUrl}/projects/${pid}/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 1 }),
      });

      const vRes = await fetch(`${baseUrl}/projects/${pid}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIndex: 0, note: "Version with injected stale issue" }),
      });
      expect(vRes.status).toBe(201);

      // Inject a stale error directly into stored version's draft.issues
      const stored = await storage.getProject(pid);
      stored.versions[0].draft.issues.push({
        severity: "error",
        code: "STALE_DRAFT_ERROR",
        message: "Stale issue in draft.issues",
      });

      // Export sheet re-renders current attendees via renderCard and ignores stale draft.issues
      const exportRes = await fetch(`${baseUrl}/projects/${pid}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "sheet",
          format: "pdf",
          paper: "A4",
          acknowledgedWarnings: true,
        }),
      });
      expect(exportRes.status).toBe(200);
      expect(exportRes.headers.get("Content-Type")).toBe("application/pdf");
    });

    it("(b) export returning 422 for role 'boss'", async () => {
      const projRes = await fetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test 2b Role Boss",
          eventSpec: sampleEventSpec,
        }),
      });
      const proj = await projRes.json();
      const pid = proj.id;

      await storage.addDatasetReport(pid, {
        report: { totals: { rows: 1 } },
        people: [{ id: "P-BOSS", name: "Boss", roleId: "boss" }],
      });

      await fetch(`${baseUrl}/projects/${pid}/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 1 }),
      });

      const vRes = await fetch(`${baseUrl}/projects/${pid}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIndex: 0 }),
      });
      expect(vRes.status).toBe(201);

      const exportRes = await fetch(`${baseUrl}/projects/${pid}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "sheet",
          format: "pdf",
          paper: "A4",
          acknowledgedWarnings: true,
        }),
      });
      expect(exportRes.status).toBe(422);
      const body = await exportRes.json();
      expect(body.error.code).toBe("UNKNOWN_ROLE_ID");
      expect(body.error.issues.some((i) => i.code === "UNKNOWN_ROLE_ID")).toBe(true);
    });

    it("(c) export returning 422 for an empty role", async () => {
      const projRes = await fetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test 2c Empty Role",
          eventSpec: sampleEventSpec,
        }),
      });
      const proj = await projRes.json();
      const pid = proj.id;

      await storage.addDatasetReport(pid, {
        report: { totals: { rows: 1 } },
        people: [{ id: "P-EMPTY", name: "No Role Person", roleId: "" }],
      });

      await fetch(`${baseUrl}/projects/${pid}/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 1 }),
      });

      const vRes = await fetch(`${baseUrl}/projects/${pid}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIndex: 0 }),
      });
      expect(vRes.status).toBe(201);

      const exportRes = await fetch(`${baseUrl}/projects/${pid}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "sheet",
          format: "pdf",
          paper: "A4",
          acknowledgedWarnings: true,
        }),
      });
      expect(exportRes.status).toBe(422);
      const body = await exportRes.json();
      expect(body.error.code).toBe("UNKNOWN_ROLE_ID");
    });

    it("(d) a genuine attendee whose name contains 'dry-run' or 'PREVIEW-' still blocks export with 422", async () => {
      const projRes = await fetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test 2d dry-run and PREVIEW- names",
          eventSpec: sampleEventSpec,
        }),
      });
      const proj = await projRes.json();
      const pid = proj.id;

      await storage.addDatasetReport(pid, {
        report: { totals: { rows: 1 } },
        people: [
          { id: "ATT-DRYRUN", name: "PREVIEW dry-run", roleId: "unregistered_role" },
        ],
      });

      await fetch(`${baseUrl}/projects/${pid}/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 1 }),
      });

      const vRes = await fetch(`${baseUrl}/projects/${pid}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIndex: 0 }),
      });
      expect(vRes.status).toBe(201);

      const exportRes = await fetch(`${baseUrl}/projects/${pid}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "sheet",
          format: "pdf",
          paper: "A4",
          acknowledgedWarnings: true,
        }),
      });
      expect(exportRes.status).toBe(422);
      const body = await exportRes.json();
      expect(body.error.code).toBe("UNKNOWN_ROLE_ID");
      expect(body.error.issues.some((i) => i.code === "UNKNOWN_ROLE_ID")).toBe(true);
    });

    it("(e) an ambiguous record warning is preserved and blocks export when unacknowledged", async () => {
      const projRes = await fetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test 2e Ambiguous Record Warning",
          eventSpec: sampleEventSpec,
        }),
      });
      const proj = await projRes.json();
      const pid = proj.id;

      await storage.addDatasetReport(pid, {
        report: { totals: { rows: 1 } },
        people: [
          { id: "P-WARN", name: "Alice Missing Photo", roleId: "participant", photo: null, flags: ["NO_PHOTO"] },
        ],
      });

      await fetch(`${baseUrl}/projects/${pid}/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 1 }),
      });

      const vRes = await fetch(`${baseUrl}/projects/${pid}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIndex: 0 }),
      });
      expect(vRes.status).toBe(201);

      // With acknowledgedWarnings: false, export must refuse with 422 NO_PHOTO
      const exportRes = await fetch(`${baseUrl}/projects/${pid}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "sheet",
          format: "pdf",
          paper: "A4",
          acknowledgedWarnings: false,
        }),
      });
      expect(exportRes.status).toBe(422);
      const body = await exportRes.json();
      expect(body.error.code).toBe("NO_PHOTO");
    });

    it("(f) a real attendee with id HX26-S-001 that exists in current data is preserved and blocks export with 422", async () => {
      const projRes = await fetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test 2f Real Attendee with Stress ID",
          eventSpec: sampleEventSpec,
        }),
      });
      const proj = await projRes.json();
      const pid = proj.id;

      await storage.addDatasetReport(pid, {
        report: { totals: { rows: 1 } },
        people: [
          { id: "HX26-S-001", name: "Sam", roleId: "bad_role" },
        ],
      });

      await fetch(`${baseUrl}/projects/${pid}/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 1 }),
      });

      const vRes = await fetch(`${baseUrl}/projects/${pid}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIndex: 0 }),
      });
      expect(vRes.status).toBe(201);

      const exportRes = await fetch(`${baseUrl}/projects/${pid}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "sheet",
          format: "pdf",
          paper: "A4",
          acknowledgedWarnings: true,
        }),
      });
      expect(exportRes.status).toBe(422);
      const body = await exportRes.json();
      expect(body.error.code).toBe("UNKNOWN_ROLE_ID");
      expect(body.error.issues.some((i) => i.code === "UNKNOWN_ROLE_ID")).toBe(true);
    });
  });
});
