// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ApiError,
  listProjects,
  getProject,
  createProject,
  uploadProjectData,
  uploadProjectPhotos,
  composeProjectDrafts,
  saveProjectVersion,
  listProjectVersions,
  exportProject,
} from "./api.js";
import {
  getValidAttendeeCount,
  computeHasDataset,
} from "./components/ProjectWorkflow.jsx";

describe("Client API Client (client/src/api.js)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("listProjects()", () => {
    it("returns array of project summaries on 200", async () => {
      const mockProjects = [
        {
          id: "proj_1",
          name: "Hackathon 2026",
          eventCode: "HACK26",
          createdAt: "2026-10-20T10:00:00.000Z",
          updatedAt: "2026-10-20T10:00:00.000Z",
        },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockProjects,
      });

      const result = await listProjects();
      expect(result).toEqual(mockProjects);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/projects",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("throws ApiError when server returns error", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({
          error: { code: "INTERNAL_ERROR", message: "Database offline" },
        }),
      });

      await expect(listProjects()).rejects.toThrow("Database offline");
    });
  });

  describe("getProject()", () => {
    it("fetches single project document by id", async () => {
      const mockProj = {
        id: "proj_123",
        name: "Conference 2026",
        eventCode: "CONF26",
        peopleCount: 150,
        datasetReport: { totals: { rows: 150, ok: 150, warnings: 0, errors: 0 } },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockProj,
      });

      const result = await getProject("proj_123");
      expect(result).toEqual(mockProj);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/projects/proj_123",
        expect.objectContaining({ method: "GET" })
      );
    });

    it("throws ApiError with NOT_FOUND on 404", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          error: { code: "NOT_FOUND", message: "Project not found" },
        }),
      });

      await expect(getProject("unknown_id")).rejects.toThrow("Project not found");
    });
  });

  describe("createProject()", () => {
    it("posts valid JSON body and returns created project", async () => {
      const mockCreated = {
        id: "proj_new_1",
        name: "NIT Surat Hackathon",
        eventCode: "NSH26",
        peopleCount: 0,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => mockCreated,
      });

      const result = await createProject({
        name: "NIT Surat Hackathon",
        eventSpec: { schemaVersion: 1 },
        eventCode: "NSH26",
      });

      expect(result).toEqual(mockCreated);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/projects",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "NIT Surat Hackathon",
            eventSpec: { schemaVersion: 1 },
            eventCode: "NSH26",
          }),
        })
      );
    });

    it("throws ApiError on validation failure (HTTP 400)", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: { code: "INVALID_REQUEST", message: "Project name is required" },
        }),
      });

      await expect(
        createProject({ name: "", eventSpec: {} })
      ).rejects.toThrow("Project name is required");
    });
  });

  describe("uploadProjectData()", () => {
    it("sends raw bytes with query params and returns report on 200", async () => {
      const mockReport = {
        format: "csv",
        totals: { rows: 10, ok: 10, warnings: 0, errors: 0 },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ report: mockReport }),
      });

      const dummyFile = new Blob(["id,name,role\n1,Alice,participant"], { type: "text/csv" });

      const result = await uploadProjectData("proj_123", dummyFile, {
        kind: "csv",
        contentType: "text/csv",
      });

      expect(result.ok).toBe(true);
      expect(result.report).toEqual(mockReport);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/projects/proj_123/data?kind=csv",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "text/csv",
            Accept: "application/json",
          },
          body: dummyFile,
        })
      );
    });

    it("attaches report to thrown error on HTTP 422 with zero valid participants", async () => {
      const mockErrorReport = {
        totals: { rows: 1, ok: 0, warnings: 0, errors: 1 },
        rows: [{ rowNumber: 1, status: "ERROR", issues: [{ code: "UNKNOWN_ROLE_ID" }] }],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          error: { code: "DATA_VALIDATION_ERROR", message: "Zero valid participants" },
          report: mockErrorReport,
        }),
      });

      const dummyFile = new Blob(["bad data"], { type: "text/csv" });

      try {
        await uploadProjectData("proj_123", dummyFile);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.code).toBe("DATA_VALIDATION_ERROR");
        expect(err.report).toEqual(mockErrorReport);
      }
    });

    it("throws PAYLOAD_TOO_LARGE on HTTP 413", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 413,
        json: async () => ({
          error: { code: "PAYLOAD_TOO_LARGE", message: "Payload too large" },
        }),
      });

      const dummyFile = new Blob(["large data"], { type: "text/csv" });

      await expect(uploadProjectData("proj_123", dummyFile)).rejects.toThrow("Payload too large");
    });
  });

  describe("uploadProjectPhotos()", () => {
    it("sends raw zip bytes and returns matching results on 200", async () => {
      const mockResult = {
        matches: [{ rowNumber: 1, id: "P-1", file: "P-1.jpg", method: "id-exact" }],
        unmatchedFiles: ["random.jpg"],
        unmatchedRows: [2],
        warnings: [],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResult,
      });

      const dummyZip = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], {
        type: "application/zip",
      });

      const result = await uploadProjectPhotos("proj_123", dummyZip);
      expect(result.matches).toHaveLength(1);
      expect(result.unmatchedFiles).toEqual(["random.jpg"]);
      expect(result.unmatchedRows).toEqual([2]);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/projects/proj_123/photos",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/zip",
            Accept: "application/json",
          },
          body: dummyZip,
        })
      );
    });

    it("throws ApiError when dataset is missing (HTTP 400 NO_DATASET)", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: { code: "NO_DATASET", message: "Upload tabular data first" },
        }),
      });

      const dummyZip = new Blob([], { type: "application/zip" });

      await expect(uploadProjectPhotos("proj_123", dummyZip)).rejects.toThrow(
        "Upload tabular data first"
      );
    });
  });

  describe("composeProjectDrafts()", () => {
    it("composes drafts via POST /projects/:id/drafts on 200", async () => {
      const mockResult = {
        drafts: [{ svg: "<svg>1</svg>" }, { svg: "<svg>2</svg>" }, { svg: "<svg>3</svg>" }],
        seed: 12345,
        issues: [],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResult,
      });

      const result = await composeProjectDrafts("proj_123", { count: 3 });
      expect(result.drafts).toHaveLength(3);
      expect(result.seed).toBe(12345);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/projects/proj_123/drafts",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
          body: JSON.stringify({ count: 3 }),
        })
      );
    });

    it("throws ApiError when server returns 422 NO_VALID_DRAFT", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          error: { code: "NO_VALID_DRAFT", message: "No valid draft passed stress test" },
        }),
      });

      await expect(composeProjectDrafts("proj_123")).rejects.toThrow(
        "No valid draft passed stress test"
      );
    });
  });

  describe("saveProjectVersion()", () => {
    it("snapshots chosen draft into version via POST /projects/:id/versions on 201", async () => {
      const mockVersion = {
        versionNumber: 1,
        draftIndex: 0,
        draft: { svg: "<svg></svg>" },
        peopleCount: 50,
        timestamp: "2026-10-20T12:00:00.000Z",
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => mockVersion,
      });

      const result = await saveProjectVersion("proj_123", { draftIndex: 0, note: "Initial" });
      expect(result.versionNumber).toBe(1);
      expect(result.draftIndex).toBe(0);
      expect(result.peopleCount).toBe(50);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/projects/proj_123/versions",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ draftIndex: 0, note: "Initial" }),
        })
      );
    });

    it("throws ApiError on 400 NO_DRAFTS error", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: { code: "NO_DRAFTS", message: "Compose drafts first" },
        }),
      });

      await expect(saveProjectVersion("proj_123", { draftIndex: 1 })).rejects.toThrow(
        "Compose drafts first"
      );
    });
  });

  describe("listProjectVersions()", () => {
    it("returns array of versions via GET /projects/:id/versions on 200", async () => {
      const mockVersions = [
        { versionNumber: 1, draftIndex: 0, peopleCount: 50 },
        { versionNumber: 2, draftIndex: 2, peopleCount: 50 },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockVersions,
      });

      const result = await listProjectVersions("proj_123");
      expect(result).toHaveLength(2);
      expect(result[0].versionNumber).toBe(1);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/projects/proj_123/versions",
        expect.objectContaining({ method: "GET" })
      );
    });
  });

  describe("exportProject()", () => {
    it("handles successful binary PDF sheet export on 200 with Content-Disposition", async () => {
      const mockBlob = new Blob(["mock-pdf-content"], { type: "application/pdf" });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="NSH26-print-sheets.pdf"',
        }),
        blob: async () => mockBlob,
      });

      const result = await exportProject("proj_123", {
        version: 1,
        kind: "sheet",
        format: "pdf",
        paper: "A4",
        acknowledgedWarnings: true,
      });

      expect(result.filename).toBe("NSH26-print-sheets.pdf");
      expect(result.mimeType).toBe("application/pdf");
      expect(result.size).toBe(mockBlob.size);
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/projects/proj_123/export",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            version: 1,
            kind: "sheet",
            format: "pdf",
            paper: "A4",
            acknowledgedWarnings: true,
          }),
        })
      );
    });

    it("handles successful batch ZIP export on 200", async () => {
      const mockBlob = new Blob(["mock-zip-content"], { type: "application/zip" });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="export.zip"',
        }),
        blob: async () => mockBlob,
      });

      const result = await exportProject("proj_123", {
        kind: "zip",
        format: "pdf",
        acknowledgedWarnings: true,
      });

      expect(result.filename).toBe("export.zip");
      expect(result.mimeType).toBe("application/zip");
    });

    it("throws ApiError with PREFLIGHT_FAILED on 422 with validation issues", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          error: {
            code: "PREFLIGHT_FAILED",
            message: "Unacknowledged warnings",
            issues: [{ code: "NO_PHOTO", severity: "warning", message: "Missing photo" }],
          },
        }),
      });

      await expect(
        exportProject("proj_123", { kind: "sheet", format: "pdf" })
      ).rejects.toThrow("Unacknowledged warnings");
    });

    it("throws ApiError with EXPORT_IN_PROGRESS on 409 concurrency lock", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            code: "EXPORT_IN_PROGRESS",
            message: "An export is already running for project",
          },
        }),
      });

      await expect(
        exportProject("proj_123", { kind: "sheet" })
      ).rejects.toThrow("An export is already running for project");
    });
  });

  describe("Network error handling", () => {
    it("catches network failure and throws clean ApiError", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Failed to fetch"));

      await expect(listProjects()).rejects.toThrow(
        "Unable to connect to server at http://localhost:3000"
      );
    });
  });

  describe("Photo Upload Gating & Dataset Calculations", () => {
    it("enables photo upload after successful import when rows have non-fatal warnings (totals.ok is 0)", () => {
      // Scenario from bug report: 5 rows uploaded, all 5 have NO_PHOTO and MISSING_OPTIONAL_FIELD (org)
      const mockReport = {
        totals: {
          rows: 5,
          ok: 0,
          warnings: 5,
          errors: 0,
        },
      };

      const validCount = getValidAttendeeCount(mockReport);
      expect(validCount).toBe(5);

      const project = { id: "proj_1", name: "Hackathon", peopleCount: 0 };
      const hasDataset = computeHasDataset(project, mockReport, null);
      expect(hasDataset).toBe(true);
    });

    it("keeps photo upload gated when import fails with zero valid attendees (HTTP 422)", () => {
      // Failed import: all 5 rows had fatal errors
      const errorReport = {
        totals: {
          rows: 5,
          ok: 0,
          warnings: 0,
          errors: 5,
        },
      };

      const validCount = getValidAttendeeCount(errorReport);
      expect(validCount).toBe(0);

      const project = { id: "proj_1", name: "Hackathon", peopleCount: 0 };
      const hasDataset = computeHasDataset(project, errorReport, "Dataset validation failed");
      expect(hasDataset).toBe(false);
    });

    it("restores unlocked photo upload state immediately when reopening a project with saved data", () => {
      // Project reopened from GET /projects/:id
      const savedProject = {
        id: "proj_saved",
        name: "Annual Gala",
        peopleCount: 42,
        datasetReport: {
          totals: {
            rows: 42,
            ok: 0,
            warnings: 42,
            errors: 0,
          },
        },
      };

      const hasDataset = computeHasDataset(savedProject, savedProject.datasetReport, null);
      expect(hasDataset).toBe(true);
    });

    it("keeps photo upload gated when project is empty without dataset or report", () => {
      const emptyProject = { id: "proj_empty", name: "New Event", peopleCount: 0 };
      const hasDataset = computeHasDataset(emptyProject, null, null);
      expect(hasDataset).toBe(false);
    });
  });
});
