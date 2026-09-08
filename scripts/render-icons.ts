import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

function render(svg: string, size: number, out: string): void {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
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
render(icon, 1024, 'icon.png');
render(icon, 48, 'favicon.png');
render(mark, 1024, 'splash-icon.png');
render(insetForAdaptive(mark), 1024, 'android-icon-foreground.png');
render(insetForAdaptive(mono), 1024, 'android-icon-monochrome.png');
render(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><rect width="1024" height="1024" fill="${TEAL}"/></svg>`,
  1024,
  'android-icon-background.png',
);
