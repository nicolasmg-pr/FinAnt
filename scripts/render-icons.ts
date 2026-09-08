import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';

/**
 * Every icon PNG in the app is build output. The SVGs under assets/brand are
 * the only place the mark is drawn, so changing it is one edit rather than six
 * exports that drift apart.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(root, 'apps/mobile/assets/brand');
const assets = join(root, 'apps/mobile/assets');

const TEAL = '#06695F';

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilter(raw: Buffer, width: number, height: number, channels: number): Buffer {
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++] ?? 0;
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const byte = raw[pos++] ?? 0;
      const a = x >= channels ? out[rowStart + x - channels]! : 0;
      const b = y > 0 ? out[rowStart - stride + x]! : 0;
      const c = y > 0 && x >= channels ? out[rowStart - stride + x - channels]! : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = byte;
          break;
        case 1:
          value = byte + a;
          break;
        case 2:
          value = byte + b;
          break;
        case 3:
          value = byte + Math.floor((a + b) / 2);
          break;
        case 4:
          value = byte + paeth(a, b, c);
          break;
        default:
          throw new Error(`Unsupported PNG filter type ${filter}`);
      }
      out[rowStart + x] = value & 0xff;
    }
  }
  return out;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(Number(crc32(typed)) >>> 0, 0);
  return Buffer.concat([length, typed, crc]);
}

/**
 * resvg-js's asPng() always writes an RGBA PNG, even for a fully opaque
 * canvas. Apple's App Store validation rejects an app icon that carries an
 * alpha channel at all, regardless of whether every pixel is opaque, so the
 * app icon is re-encoded here to plain RGB with the channel dropped.
 */
function stripAlphaChannel(png: Buffer): Buffer {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const colorType = png.readUInt8(25);
  if (colorType !== 6) return png; // already free of an alpha channel

  const idat: Buffer[] = [];
  let pos = 8;
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idat.push(png.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const rgba = unfilter(inflateSync(Buffer.concat(idat)), width, height, 4);

  const stride = width * 3;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    filtered[rowStart] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = rowStart + 1 + x * 3;
      filtered[dst] = rgba[src]!;
      filtered[dst + 1] = rgba[src + 1]!;
      filtered[dst + 2] = rgba[src + 2]!;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // color type: truecolor, no alpha
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  return Buffer.concat([
    png.subarray(0, 8), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(filtered)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(svg: string, size: number, out: string, opts: { opaque?: boolean } = {}): void {
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  const png = opts.opaque ? stripAlphaChannel(rendered) : rendered;
  writeFileSync(join(assets, out), png);
  console.log(`${out} — ${size}px`);
}

function read(name: string): string {
  return readFileSync(join(brand, name), 'utf8');
}

/**
 * Android's adaptive mask can crop anything outside the central 66% of the
 * canvas, and a round mask on a square mark takes the antennae first.
 */
function insetForAdaptive(svg: string): string {
  const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">',
    '<g transform="translate(512 512) scale(0.62) translate(-512 -512)">',
    body,
    '</g></svg>',
  ].join('');
}

const icon = read('icon.svg');
const mark = read('icon-mark.svg');
const mono = read('icon-mono.svg');

// Opaque: Apple rejects an alpha channel on the app icon.
render(icon, 1024, 'icon.png', { opaque: true });
render(icon, 48, 'favicon.png');
render(mark, 1024, 'splash-icon.png');
render(insetForAdaptive(mark), 1024, 'android-icon-foreground.png');
render(insetForAdaptive(mono), 1024, 'android-icon-monochrome.png');
render(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><rect width="1024" height="1024" fill="${TEAL}"/></svg>`,
  1024,
  'android-icon-background.png',
);
