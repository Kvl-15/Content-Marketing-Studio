// @ts-check

import { writeFile } from "node:fs/promises";
import sharp from "sharp";

/** @param {Buffer} data */
function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}

/** @param {Array<{name:string,data:Buffer}>} entries */
function makeStoredZip(entries) {
  const locals = []; const central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name); const checksum = crc32(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
    locals.push(Buffer.concat([local, entry.data]));
    const record = Buffer.alloc(46 + name.length);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(entry.data.length, 20); record.writeUInt32LE(entry.data.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42); name.copy(record, 46);
    central.push(record); offset += local.length + entry.data.length;
  }
  const centralBytes = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

/** Build the temporary demo ZIP used by the hand-check. */
export async function buildDemoPhotoZip(outputPath) {
  const photo = await sharp({ create: { width: 800, height: 1200, channels: 3, background: { r: 40, g: 100, b: 180 } } }).jpeg({ quality: 82 }).toBuffer();
  const zip = makeStoredZip([
    { name: "HX26-001.jpg", data: photo },
    { name: "zoe-profile.jpg", data: photo },
    { name: "mira@example.test.jpg", data: photo },
    { name: "unmatched-one.jpg", data: photo },
    { name: "unmatched-two.jpg", data: photo },
  ]);
  await writeFile(outputPath, zip);
  return outputPath;
}
