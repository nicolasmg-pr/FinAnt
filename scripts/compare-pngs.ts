import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

/**
 * Compares two directories of PNGs pixel by pixel.
 *
 * Used to prove that moving the mark's geometry into `src/design/mascot.ts` did
 * not move the mark. Byte comparison is too strict — attribute order out of the
 * serialiser can shift anti-aliasing by a bit without moving anything — and
 * eyeballing is too loose, because the failure this guards against looks fine at
 * 1024 and wrong at 48.
 */
const MAX_CHANNEL_DELTA = 2;
const MAX_DIFFERING_FRACTION = 0.0005;

interface Image {
  width: number;
  height: number;
  pixels: Uint8Array;
}

function decode(path: string): Image {
  const file = readFileSync(path);
  let pos = 8;
  let width = 0;
  let height = 0;
  let colourType = 0;
  const chunks: Buffer[] = [];
  while (pos < file.length) {
    const length = file.readUInt32BE(pos);
    const type = file.subarray(pos + 4, pos + 8).toString('ascii');
    if (type === 'IHDR') {
      width = file.readUInt32BE(pos + 8);
      height = file.readUInt32BE(pos + 12);
      colourType = file[pos + 17]!;
    } else if (type === 'IDAT') {
      chunks.push(file.subarray(pos + 8, pos + 8 + length));
    }
    pos += 12 + length;
  }
  const channels = colourType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = new Uint8Array(width * height * 4);
  let offset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[offset++]!;
    const line = Buffer.from(raw.subarray(offset, offset + stride));
    offset += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels]! : 0;
      const b = previous[x]!;
      const c = x >= channels ? previous[x - channels]! : 0;
      if (filter === 1) line[x] = (line[x]! + a) & 255;
      else if (filter === 2) line[x] = (line[x]! + b) & 255;
      else if (filter === 3) line[x] = (line[x]! + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[x] = (line[x]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    for (let x = 0; x < width; x++) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      pixels[to] = line[from]!;
      pixels[to + 1] = line[from + 1]!;
      pixels[to + 2] = line[from + 2]!;
      pixels[to + 3] = channels === 4 ? line[from + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, pixels };
}

const [baseline, current] = process.argv.slice(2);
if (!baseline || !current) {
  console.error('usage: tsx scripts/compare-pngs.ts <baseline-dir> <current-dir>');
  process.exit(2);
}

let failed = 0;
for (const name of readdirSync(baseline)
  .filter((f) => f.endsWith('.png'))
  .sort()) {
  const before = decode(join(baseline, name));
  const after = decode(join(current, name));
  if (before.width !== after.width || before.height !== after.height) {
    console.log(
      `${name}: SIZE CHANGED ${before.width}x${before.height} -> ${after.width}x${after.height}`,
    );
    failed++;
    continue;
  }
  let differing = 0;
  let worst = 0;
  for (let i = 0; i < before.pixels.length; i++) {
    const delta = Math.abs(before.pixels[i]! - after.pixels[i]!);
    if (delta > 0) {
      if (i % 4 === 0) differing++;
      if (delta > worst) worst = delta;
    }
  }
  const total = before.width * before.height;
  const fraction = differing / total;
  const ok = worst <= MAX_CHANNEL_DELTA && fraction <= MAX_DIFFERING_FRACTION;
  if (!ok) failed++;
  console.log(
    `${name.padEnd(30)} worst delta ${String(worst).padStart(3)}  differing ${(fraction * 100).toFixed(4)}%  ${ok ? 'ok' : 'FAIL'}`,
  );
}
console.log(failed === 0 ? '\nall six match' : `\n${failed} image(s) moved`);
process.exit(failed === 0 ? 0 : 1);
