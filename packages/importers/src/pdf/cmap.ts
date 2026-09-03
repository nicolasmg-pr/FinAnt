/**
 * `ToUnicode` CMaps: the only way back from a glyph code to a character.
 *
 * A statement rendered from HTML embeds subset fonts as `Type0` /
 * `CIDFontType2`, so the strings in the content stream are glyph ids in the
 * subset's own order — `<0003>` is whatever glyph the subsetter put third, and
 * carries no meaning at all without this table.
 */

export interface CMap {
  /** Bytes per code. Two for the Identity encodings a subset font uses. */
  readonly codeBytes: number;
  /** The characters a code stands for, or null when the map has no entry. */
  lookup(code: number): string | null;
}

const EMPTY: CMap = { codeBytes: 2, lookup: () => null };

export const IDENTITY_CMAP = EMPTY;

/** UTF-16BE bytes, as a CMap's destination values are written. */
function utf16(hex: string): string {
  let out = '';
  for (let i = 0; i + 3 < hex.length + 1; i += 4) {
    const unit = Number.parseInt(hex.slice(i, i + 4), 16);
    if (Number.isNaN(unit)) break;
    out += String.fromCharCode(unit);
  }
  return out;
}

/** Every `<...>` token in a slice, as upper-case hex without the brackets. */
function hexTokens(source: string): string[] {
  return [...source.matchAll(/<([0-9a-fA-F\s]*)>/g)].map((m) => (m[1] ?? '').replace(/\s+/g, ''));
}

export function parseCMap(bytes: Uint8Array): CMap {
  let source = '';
  for (const byte of bytes) source += String.fromCharCode(byte);

  const map = new Map<number, string>();
  let codeBytes = 0;

  const codespace = /begincodespacerange([\s\S]*?)endcodespacerange/g;
  for (let hit = codespace.exec(source); hit !== null; hit = codespace.exec(source)) {
    const token = hexTokens(hit[1] ?? '')[0];
    if (token) codeBytes = Math.max(codeBytes, Math.ceil(token.length / 2));
  }

  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
  for (let hit = bfchar.exec(source); hit !== null; hit = bfchar.exec(source)) {
    const tokens = hexTokens(hit[1] ?? '');
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      const code = Number.parseInt(tokens[i]!, 16);
      if (!Number.isNaN(code)) map.set(code, utf16(tokens[i + 1]!));
    }
  }

  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
  for (let hit = bfrange.exec(source); hit !== null; hit = bfrange.exec(source)) {
    readRanges(hit[1] ?? '', map);
  }

  return {
    codeBytes: codeBytes > 0 ? codeBytes : 2,
    lookup: (code) => map.get(code) ?? null,
  };
}

/**
 * `bfrange` comes in two forms: a start code, an end code and either a single
 * destination that increments across the range, or a bracketed array with one
 * destination per code.
 */
function readRanges(body: string, map: Map<number, string>): void {
  const entry =
    /<([0-9a-fA-F\s]*)>\s*<([0-9a-fA-F\s]*)>\s*(\[[\s\S]*?\]|<[0-9a-fA-F\s]*>)/g;
  for (let hit = entry.exec(body); hit !== null; hit = entry.exec(body)) {
    const from = Number.parseInt((hit[1] ?? '').replace(/\s+/g, ''), 16);
    const to = Number.parseInt((hit[2] ?? '').replace(/\s+/g, ''), 16);
    const destination = hit[3] ?? '';
    if (Number.isNaN(from) || Number.isNaN(to) || to < from) continue;
    // A range covering the whole code space would be a malformed file; cap it
    // rather than allocating millions of entries from one bad token.
    const last = Math.min(to, from + 65535);

    if (destination.startsWith('[')) {
      const items = hexTokens(destination);
      for (let code = from; code <= last; code += 1) {
        const item = items[code - from];
        if (item !== undefined) map.set(code, utf16(item));
      }
      continue;
    }
    const base = (hexTokens(destination)[0] ?? '').replace(/\s+/g, '');
    if (base === '') continue;
    const start = Number.parseInt(base, 16);
    if (Number.isNaN(start)) continue;
    const width = base.length;
    for (let code = from; code <= last; code += 1) {
      map.set(code, utf16((start + (code - from)).toString(16).padStart(width, '0')));
    }
  }
}
