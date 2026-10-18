import opentype from 'opentype.js';
import fs from 'fs';

const fontFiles = [
  'scratch/proposed-fonts/SpaceGrotesk-Bold.ttf',
  'scratch/proposed-fonts/SpaceGrotesk-Regular.ttf',
  'scratch/proposed-fonts/Inter-Bold.ttf',
  'scratch/proposed-fonts/Inter-Regular.ttf',
  'scratch/proposed-fonts/SourceSans3-Bold.ttf',
  'scratch/proposed-fonts/SourceSans3-Regular.ttf'
];

const testChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?:;"\'- /#@&';

for (const file of fontFiles) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const font = opentype.parse(ab);
  const isStatic = !font.tables.fvar;
  const missing = [];
  for (const ch of testChars) {
    const glyph = font.charToGlyph(ch);
    if (!glyph || glyph.index === 0) missing.push(ch);
  }
  console.log(file, JSON.stringify({
    unitsPerEm: font.unitsPerEm,
    isStatic,
    hasFvar: !!font.tables.fvar,
    numGlyphs: font.numGlyphs,
    allLatinPassed: missing.length === 0,
    missingChars: missing
  }, null, 2));
}
