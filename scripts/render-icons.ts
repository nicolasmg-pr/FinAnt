import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';
import { markSvg, monoSvg } from './mascot-svg';

/**
 * The mark's geometry lives in `apps/mobile/src/design/mascot.ts`, the only
 * place it is drawn. This script serialises that geometry to `icon-mark.svg`
 * (full mark) and `icon-mono.svg` (simplified mark), then rasterises every
 * icon PNG, including the cream-background composite the app icon needs,
 * from those two at render time. The SVGs are generated output, not sources
 * to edit by hand — changing the mark is one edit to `mascot.ts` rather than
 * several files (or several PNG exports) that drift apart.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(root, 'apps/mobile/assets/brand');
const assets = join(root, 'apps/mobile/assets');

const CREAM = '#F2F6F5';

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(Number(crc32(typed)) >>> 0, 0);
  return Buffer.concat([length, typed, crc]);
}

/**
 * resvg's `asPng()` always writes an RGBA PNG, even for a fully opaque
 * canvas. Apple's App Store validation rejects an app icon that carries an
 * alpha channel at all, regardless of whether every pixel is opaque, so the
 * app icon is built here directly from the renderer's raw RGB(A) pixels,
 * dropping the alpha byte, rather than asking resvg for a PNG and inspecting
 * one we'd have to decode back out again.
 */
function encodeOpaquePng(pixels: Buffer, width: number, height: number): Buffer {
  const stride = width * 3;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    filtered[rowStart] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = rowStart + 1 + x * 3;
      filtered[dst] = pixels[src]!;
      filtered[dst + 1] = pixels[src + 1]!;
      filtered[dst + 2] = pixels[src + 2]!;
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

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(filtered)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(svg: string, size: number, out: string, opts: { opaque?: boolean } = {}): void {
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render();
  const png = opts.opaque
    ? encodeOpaquePng(rendered.pixels, rendered.width, rendered.height)
    : rendered.asPng();
  writeFileSync(join(assets, out), png);
  console.log(`${out} — ${size}px`);
}

function read(name: string): string {
  return readFileSync(join(brand, name), 'utf8');
}

/** Strip the outer `<svg>` tag, leaving the drawable content to rewrap. */
function innerContent(svg: string): string {
  return svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}

/**
 * Android's adaptive mask can crop anything outside the central 66% of the
 * canvas, and a round mask on a square mark takes the antennae first.
 */
function insetForAdaptive(svg: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">',
    '<g transform="translate(512 512) scale(0.62) translate(-512 -512)">',
    innerContent(svg),
    '</g></svg>',
  ].join('');
}

/** Lays a solid ground behind the mark, e.g. the cream the app icon needs. */
function withBackground(svg: string, colour: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">',
    `<rect width="1024" height="1024" fill="${colour}"/>`,
    innerContent(svg),
    '</svg>',
  ].join('');
}

writeFileSync(join(brand, 'icon-mark.svg'), markSvg());
writeFileSync(join(brand, 'icon-mono.svg'), monoSvg());

const mark = read('icon-mark.svg');
const mono = read('icon-mono.svg');

// Opaque: Apple rejects an alpha channel on the app icon.
render(withBackground(mark, CREAM), 1024, 'icon.png', { opaque: true });
render(withBackground(mark, CREAM), 48, 'favicon.png');
render(mark, 1024, 'splash-icon.png');
render(insetForAdaptive(mark), 1024, 'android-icon-foreground.png');
render(insetForAdaptive(mono), 1024, 'android-icon-monochrome.png');
render(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><rect width="1024" height="1024" fill="${CREAM}"/></svg>`,
  1024,
  'android-icon-background.png',
);
