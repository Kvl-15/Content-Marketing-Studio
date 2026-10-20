// @ts-check

import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DataParseError,
  DUPLICATE_ID,
  ROW_ISSUES,
  UNKNOWN_ROLE_ID,
  assignDeterministicIds,
  cleanCell,
  cleanRow,
  detectDelimiter,
  detectFormat,
  detectHeaderRow,
  findHeaderCollisions,
  parseDelimited,
  proposeHeaderMapping,
  mappingProposal,
  resolveRole,
  buildDataset,
  parseInput,
  UnsupportedFormatError,
} from "./index.js";

describe("content detection and CSV parsing", () => {
  it("detects JSON and BOM-prefixed delimited content from bytes", () => {
    expect(detectFormat("\uFEFF {\"name\":\"A\"}").format).toBe("json");
    expect(detectFormat(new TextEncoder().encode("name\trole\nA\tmentor")).format).toBe("csv");
    const xlsxHeader = new TextEncoder().encode("PK\x03\x04 xl/[Content_Types].xml");
    expect(detectFormat(xlsxHeader).format).toBe("xlsx");
  });

  it("selects the delimiter and parses quoted fields, embedded newlines, and blank lines", () => {
    const csv = '\nName;Role;Note\n"Doe, Jane";mentor;"line one\nline two"\n\n';
    expect(detectDelimiter(csv)).toBe(";");
    expect(parseDelimited(csv, ";")).toEqual([
      ["Name", "Role", "Note"],
      ["Doe, Jane", "mentor", "line one\nline two"],
    ]);
  });

  it("raises a typed parse error for an unclosed quoted field", () => {
    expect(() => parseDelimited('name,notes\nA,"missing')).toThrow(DataParseError);
  });

  it.each([
    [Buffer.alloc(0), "empty"],
    [Buffer.from([0xff, 0xfe, 0x00, 0x01]), "binary"],
  ])("rejects %s input with a typed error", (input) => {
    expect(() => parseInput(input)).toThrow(UnsupportedFormatError);
  });

  it("accepts BOM and semicolon input, while header-only remains an empty dataset", () => {
    expect(parseInput("\uFEFFName;Role\nA;Mentor").rows).toEqual([["Name", "Role"], ["A", "Mentor"]]);
    expect(parseInput("Name,Role\n").rows).toEqual([["Name", "Role"]]);
  });
});

describe("headers", () => {
  it("skips a title row, detects collisions, and proposes deterministic mappings", () => {
    const result = detectHeaderRow([["Roster export"], ["Name", "Role", "Role", "Email"], ["A", "mentor", "mentor", "a@example.test"]]);
    expect(result.headerRowIndex).toBe(1);
    expect(result.collisions[0].columns).toEqual([1, 2]);
    expect(findHeaderCollisions(["Role", " role "])).toEqual([{ normalized: "role", columns: [0, 1] }]);
    expect(proposeHeaderMapping(["Name", "Role", "Not in schema"]).map((item) => item.target)).toEqual(["name", "roleId", null]);
    expect(proposeHeaderMapping(["Email ID", "Email"]).map((item) => item.candidates[0].target)).toEqual(["email", "email"]);
    expect(mappingProposal(["Email ID", "Email"]).competing.email).toHaveLength(2);
  });

  it("resolves name, role, participant_id correctly and preserves genuine ambiguity", () => {
    const proposal = mappingProposal(["name", "role", "participant_id"]);
    expect(proposal.mapping).toEqual({ name: 0, roleId: 1, id: 2 });
    expect(proposal.competing).toEqual({});

    const ambiguous = mappingProposal(["Full Name", "Display Name", "Role", "ID"]);
    expect(ambiguous.competing.name).toBeDefined();
    expect(ambiguous.competing.name.length).toBeGreaterThanOrEqual(2);
    expect(ambiguous.mapping.name).toBeUndefined();
    expect(ambiguous.mapping.roleId).toBe(2);
    expect(ambiguous.mapping.id).toBe(3);
  });
});

describe("cleaning, roles, and IDs", () => {
  it("normalizes NFC, whitespace, controls, and zero-width characters", () => {
    expect(cleanCell("  Cafe\u0301\u200B\n\tA\u0000  ")).toBe("Café A");
    expect(cleanRow({ name: "A", note: "=1+1", plus: "+risk" }).formulaLikeCount).toBe(2);
    expect(cleanRow({ note: "-10" }).formulaLikeCount).toBe(1);
  });

  it("resolves role IDs and labels while surfacing unknown roles", () => {
    const spec = { roles: [{ id: "mentor", label: "Mentor" }, { id: "student", label: "Student" }] };
    expect(resolveRole("mentor", spec).roleId).toBe("mentor");
    expect(resolveRole(" student ", spec).roleId).toBe("student");
    expect(resolveRole("speaker", spec).issue.code).toBe(UNKNOWN_ROLE_ID);
  });

  it("assigns stable IDs and reports duplicates deterministically", () => {
    const a = assignDeterministicIds([{ name: "A", email: "a@example.test" }, { name: "A", email: "a@example.test" }]);
    expect(a.rows[0].id).not.toBe(a.rows[1].id);
    expect(a.issues).toHaveLength(2);
    expect(a.issues.filter((issue) => issue.code === DUPLICATE_ID)).toHaveLength(0);
    expect(ROW_ISSUES.UNKNOWN_ROLE_ID).toBe(UNKNOWN_ROLE_ID);
  });

  it("reserves imported IDs before generating IDs, including shared role letters", () => {
    const input = [
      { id: "HX26-P-001", roleId: "participant" },
      { id: "", roleId: "participant" },
      { id: "hx26-p-003", roleId: "participant" },
      { id: "", roleId: "participant" },
      { id: "", roleId: "presenter" },
      { id: "", roleId: "participant" },
      { id: "HX26-001", roleId: "participant" },
      { id: "HX26-P-001", roleId: "mentor" },
      { id: "", roleId: "participant" },
      { id: "", roleId: "participant" },
    ];
    const first = assignDeterministicIds(input, { eventCode: "HX26" });
    const second = assignDeterministicIds(input, { eventCode: "HX26" });

    expect(first.rows.map((row) => row.id)).toEqual([
      "HX26-P-001",
      "HX26-P-002",
      "hx26-p-003",
      "HX26-P-004",
      "HX26-P-005",
      "HX26-P-006",
      "HX26-001",
      "HX26-P-001",
      "HX26-P-007",
      "HX26-P-008",
    ]);
    expect(first.rows.map((row) => row.id)).toEqual(second.rows.map((row) => row.id));
    expect(first.issues.filter((issue) => issue.code === DUPLICATE_ID)).toHaveLength(2);
    expect(new Set(first.rows.filter((row, index) => !input[index].id).map((row) => row.id)).size).toBe(6);
  });
});

describe("dataset integration", () => {
  const eventSpec = {
    roles: [
      { id: "participant", label: "PARTICIPANT" },
      { id: "mentor", label: "Mentor" },
      { id: "organizer", label: "Organizer" },
    ],
    qr: { enabled: true, urlPattern: "https://example.test/checkin/{id}" },
  };

  it("builds validated people, excludes errors, and keeps a deterministic report", async () => {
    const csv = await readFile(new URL("../../fixtures/messy.csv", import.meta.url), "utf8");
    const mapping = { id: "ID", name: "Full Name", roleId: "Role", org: "Organization", email: "Email", photo: "Photo URL" };
    const first = await buildDataset(csv, { eventSpec, mapping, eventCode: "HX26" });
    const second = await buildDataset(csv, { eventSpec, mapping, eventCode: "HX26" });
    expect(first.people.every((person) => person.name && person.roleId && person.photo === null)).toBe(true);
    expect(first.report).toEqual(second.report);
    expect(JSON.stringify(first.report)).toBe(JSON.stringify(second.report));
    expect(first.report.rows.some((row) => row.status === "ERROR")).toBe(true);
    expect(first.report.rows.some((row) => row.issues.some((issue) => issue.code === "DUPLICATE_EMAIL"))).toBe(true);
    expect(first.report.rows.some((row) => row.issues.some((issue) => issue.code === "UNKNOWN_ROLE_ID"))).toBe(true);
    expect(first.report.rows.some((row) => row.issues.some((issue) => issue.code === "NO_PHOTO"))).toBe(true);
    for (const row of first.report.rows) {
      const codes = row.issues.map((issue) => issue.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
    const missingRole = first.report.rows.find((row) => row.rowNumber === 24);
    expect(missingRole?.issues.find((issue) => issue.code === UNKNOWN_ROLE_ID)?.message).toBe("Role is missing");
    expect(missingRole?.issues.filter((issue) => issue.code === "INVALID_ROW")).toHaveLength(0);
  });

  it("parses an XLSX first sheet and reports that fact", async () => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["Full Name", "Role"], ["A Person", "Mentor"]]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Roster");
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const result = await buildDataset(bytes, { eventSpec, mapping: { name: "Full Name", roleId: "Role" }, eventCode: "HX26" });
    expect(result.report.format).toBe("xlsx");
    expect(result.report.firstSheet).toBe("Roster");
    expect(result.people[0].id).toBe("HX26-M-001");
  });

  it("builds a dataset from CSV with name, role, participant_id headers and auto-proposed mapping", async () => {
    const csv = "name,role,participant_id\nAlice Smith,participant,P-101\nBob Jones,mentor,P-102\n";
    const proposal = mappingProposal(["name", "role", "participant_id"]);
    const result = await buildDataset(csv, { eventSpec, mapping: proposal.mapping, eventCode: "HX26" });
    expect(result.people).toHaveLength(2);
    expect(result.people[0].name).toBe("Alice Smith");
    expect(result.people[0].id).toBe("P-101");
    expect(result.people[0].roleId).toBe("participant");
    expect(result.report.totals.errors).toBe(0);
    expect(result.report.totals.rows).toBe(2);
  });

  it("builds a 235-row dataset end to end with a photo ZIP", async () => {
    const sharp = (await import("sharp")).default;
    const photo = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#d33" } }).jpeg().toBuffer();
    const crcTable = (() => { const table = []; for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : c >>> 1; table[n] = c >>> 0; } return table; })();
    const crc32 = (data) => { let c = 0xffffffff; for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const name = Buffer.from("HX26-P-001.jpg"); const compressed = deflateRawSync(photo);
    const local = Buffer.alloc(30 + name.length); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(photo), 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(photo.length, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(photo), 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(photo.length, 24); central.writeUInt16LE(name.length, 28); name.copy(central, 46);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length + compressed.length, 16);
    const zip = Buffer.concat([local, compressed, central, end]);
    const rows = ["Full Name,Role", ...Array.from({ length: 235 }, (_, index) => `Person ${index + 1},Participant`)].join("\n");
    const outputDir = await mkdtemp(join(tmpdir(), "a2-data-"));
    const started = performance.now();
    const result = await buildDataset(rows, { eventSpec, mapping: { name: "Full Name", roleId: "Role" }, eventCode: "HX26", photos: zip, outputDir });
    const elapsedMs = Math.round(performance.now() - started);
    console.log(JSON.stringify({ datasetRows: 235, elapsedMs }));
    await rm(outputDir, { recursive: true, force: true });
    expect(result.people).toHaveLength(235);
    expect(result.report.totals.rows).toBe(235);
    expect(result.report.unmatchedPhotoFiles).toEqual([]);
  });
});
