// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ApiError,
  listProjects,
  getProject,
  createProject,
  uploadProjectData,
  uploadProjectPhotos,
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
