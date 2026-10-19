// @ts-check

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildDataset } from "./pipeline.js";
import { buildDemoPhotoZip } from "./demo-zip.js";

const fixturePath = resolve(process.argv[2] ?? "fixtures/messy.csv");
const makeZipIndex = process.argv.indexOf("--make-test-zip");
const suppliedZip = makeZipIndex >= 0 ? process.argv[makeZipIndex + 1] : process.argv[3];
const zipPath = suppliedZip ? resolve(suppliedZip) : null;
const outputDir = resolve(process.argv[makeZipIndex >= 0 ? makeZipIndex + 2 : 4] ?? "server/data/demo-output");

if (makeZipIndex >= 0 && zipPath) await buildDemoPhotoZip(zipPath);

const input = await readFile(fixturePath);
const eventSpec = {
  roles: [
    { id: "participant", label: "PARTICIPANT" },
    { id: "mentor", label: "MENTOR" },
    { id: "organizer", label: "ORGANIZER" },
  ],
  qr: { enabled: true, urlPattern: "https://example.org/checkin/{id}" },
};
const result = await buildDataset(input, {
  eventSpec,
  eventCode: "HX26",
  mapping: { id: "ID", name: "Full Name", roleId: "Role", org: "Organization", email: "Email", photo: "Photo URL" },
  photos: zipPath,
  outputDir,
});

const problemRows = result.report.rows
  .filter((row) => row.status !== "OK")
  .slice(0, 5)
  .map((row) => ({ rowNumber: row.rowNumber, id: row.id, status: row.status, codes: row.issues.map((issue) => issue.code) }));

console.log(JSON.stringify({
  summary: result.report.totals,
  peopleIncluded: result.people.length,
  matchedPhotos: result.report.matchedPhotos,
  firstProblemRows: problemRows,
  processedPhotoDirectory: outputDir,
  unmatchedPhotoFiles: result.report.unmatchedPhotoFiles,
  unmatchedRows: result.report.unmatchedRows,
}, null, 2));
