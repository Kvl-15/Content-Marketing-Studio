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
});
