/**
 * The PDF object grammar: numbers, names, strings, arrays, dictionaries and
 * indirect references.
 *
 * Written out rather than taken from a library because the only pure-JS PDF
 * reader worth using cannot be compiled by Hermes: `hermesc` rejects pdf.js's
 * dynamic worker import outright, and patching past it leads into a stack of
 * missing DOM globals. See docs/import-formats.md.
 *
 * This is deliberately the *reading* half of PDF only, and only as much of it
 * as a text-bearing bank statement uses. Nothing here renders, decrypts or
 * writes.
 */

/** A `/Name`, boxed so it cannot be confused with a string. */
export interface PdfName {
  readonly name: string;
}

/** An `n g R` indirect reference. */
export interface PdfRef {
  readonly num: number;
  readonly gen: number;
}

/** A PDF string is a byte string; text meaning depends on the font's encoding. */
export interface PdfString {
  readonly bytes: Uint8Array;
}

export type PdfDict = ReadonlyMap<string, PdfValue>;

export type PdfValue =
  | number
  | boolean
  | null
  | PdfName
  | PdfRef
  | PdfString
  | readonly PdfValue[]
  | PdfDict;

export function isName(value: PdfValue | undefined): value is PdfName {
  return typeof value === 'object' && value !== null && 'name' in value;
}

export function isRef(value: PdfValue | undefined): value is PdfRef {
  return typeof value === 'object' && value !== null && 'num' in value && 'gen' in value;
}

export function isString(value: PdfValue | undefined): value is PdfString {
  return typeof value === 'object' && value !== null && 'bytes' in value;
}

export function isDict(value: PdfValue | undefined): value is PdfDict {
  return value instanceof Map;
}

export function asName(value: PdfValue | undefined): string | null {
  return isName(value) ? value.name : null;
}

export function asNumber(value: PdfValue | undefined): number | null {
  return typeof value === 'number' ? value : null;
}

export function asDict(value: PdfValue | undefined): PdfDict {
  return isDict(value) ? value : new Map();
}

export function asArray(value: PdfValue | undefined): readonly PdfValue[] {
  return Array.isArray(value) ? value : [];
}

/** One byte per character, which is what PDF syntax and CMap keys are. */
export function latin1(value: PdfValue | undefined): string {
  if (!isString(value)) return '';
  let out = '';
  for (const byte of value.bytes) out += String.fromCharCode(byte);
  return out;
}

const SPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITER = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isRegular(byte: number | undefined): boolean {
  return byte !== undefined && !SPACE.has(byte) && !DELIMITER.has(byte);
}

/** Advances past whitespace and `%` comments, which may sit between any two tokens. */
export function skipSpace(bytes: Uint8Array, at: number): number {
  let i = at;
  while (i < bytes.length) {
    const byte = bytes[i]!;
    if (SPACE.has(byte)) {
      i += 1;
      continue;
    }
    if (byte === 0x25) {
      while (i < bytes.length && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i += 1;
      continue;
    }
    return i;
  }
  return i;
}

export interface Parsed {
  readonly value: PdfValue;
  /** Index just past the object that was read. */
  readonly end: number;
}

function readNumberToken(bytes: Uint8Array, at: number): { text: string; end: number } {
  let i = at;
  let text = '';
  while (i < bytes.length && isRegular(bytes[i])) {
    text += String.fromCharCode(bytes[i]!);
    i += 1;
  }
  return { text, end: i };
}

function readName(bytes: Uint8Array, at: number): Parsed {
  let i = at + 1;
  let name = '';
  while (i < bytes.length && isRegular(bytes[i])) {
    const byte = bytes[i]!;
    // `#` escapes let a name carry a space or a delimiter, which font
    // subset names produced by HTML-to-PDF renderers regularly do.
    if (byte === 0x23 && i + 2 < bytes.length) {
      const hex = String.fromCharCode(bytes[i + 1]!, bytes[i + 2]!);
      const code = Number.parseInt(hex, 16);
      if (!Number.isNaN(code)) {
        name += String.fromCharCode(code);
        i += 3;
        continue;
      }
    }
    name += String.fromCharCode(byte);
    i += 1;
  }
  return { value: { name }, end: i };
}

const ESCAPES: Readonly<Record<string, number>> = {
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  b: 0x08,
  f: 0x0c,
};

function readLiteralString(bytes: Uint8Array, at: number): Parsed {
  const out: number[] = [];
  let depth = 1;
  let i = at + 1;
  while (i < bytes.length && depth > 0) {
    const byte = bytes[i]!;
    if (byte === 0x5c) {
      const next = bytes[i + 1];
      if (next === undefined) break;
      const char = String.fromCharCode(next);
      if (char >= '0' && char <= '7') {
        // Up to three octal digits; a shorter run is legal and common.
        let octal = '';
        let k = i + 1;
        while (k < bytes.length && octal.length < 3) {
          const digit = String.fromCharCode(bytes[k]!);
          if (digit < '0' || digit > '7') break;
          octal += digit;
          k += 1;
        }
        out.push(Number.parseInt(octal, 8) & 0xff);
        i = k;
        continue;
      }
      if (char === '\n') {
        // A backslash before a newline continues the line and emits nothing.
        i += 2;
        continue;
      }
      if (char === '\r') {
        i += bytes[i + 2] === 0x0a ? 3 : 2;
        continue;
      }
      out.push(ESCAPES[char] ?? next);
      i += 2;
      continue;
    }
    if (byte === 0x28) depth += 1;
    if (byte === 0x29) {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
    out.push(byte);
    i += 1;
  }
  return { value: { bytes: Uint8Array.from(out) }, end: i };
}

function readHexString(bytes: Uint8Array, at: number): Parsed {
  const out: number[] = [];
  let digits = '';
  let i = at + 1;
  while (i < bytes.length && bytes[i] !== 0x3e) {
    const char = String.fromCharCode(bytes[i]!);
    if (/[0-9a-fA-F]/.test(char)) {
      digits += char;
      if (digits.length === 2) {
        out.push(Number.parseInt(digits, 16));
        digits = '';
      }
    }
    i += 1;
  }
  // "If the final digit is missing, it is assumed to be 0" — PDF 32000-1, 7.3.4.3.
  if (digits.length === 1) out.push(Number.parseInt(`${digits}0`, 16));
  return { value: { bytes: Uint8Array.from(out) }, end: i + 1 };
}

function readArray(bytes: Uint8Array, at: number): Parsed {
  const items: PdfValue[] = [];
  let i = at + 1;
  while (i < bytes.length) {
    i = skipSpace(bytes, i);
    if (bytes[i] === 0x5d) return { value: collapseRefs(items), end: i + 1 };
    const parsed = parseObject(bytes, i);
    if (parsed.end === i) break;
    items.push(parsed.value);
    i = parsed.end;
  }
  return { value: collapseRefs(items), end: i };
}

function readDict(bytes: Uint8Array, at: number): Parsed {
  const map = new Map<string, PdfValue>();
  let i = at + 2;
  while (i < bytes.length) {
    i = skipSpace(bytes, i);
    if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) return { value: map, end: i + 2 };
    if (bytes[i] !== 0x2f) break;
    const key = readName(bytes, i);
    const first = parseObject(bytes, skipSpace(bytes, key.end));
    let value = first.value;
    let cursor = first.end;
    // A value may be an `n g R` reference, which is three tokens and can only
    // be recognised by looking past the first one.
    if (typeof value === "number" && Number.isInteger(value)) {
      const gen = parseObject(bytes, skipSpace(bytes, cursor));
      if (typeof gen.value === "number" && Number.isInteger(gen.value)) {
        const marker = parseObject(bytes, skipSpace(bytes, gen.end));
        if (isName(marker.value) && marker.value.name === "R") {
          value = { num: value, gen: gen.value };
          cursor = marker.end;
        }
      }
    }
    map.set(asName(key.value) ?? "", value);
    i = cursor;
  }
  return { value: map, end: i };
}

/**
 * Turns `n g R` triples into references.
 *
 * A reference is three tokens with no bracketing of its own, so it can only be
 * recognised after the fact: `[1 0 R 2 0 R]` is two references and `[1 2]` is
 * two numbers.
 */
function collapseRefs(items: readonly PdfValue[]): PdfValue[] {
  const out: PdfValue[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const num = items[i];
    const gen = items[i + 1];
    const marker = items[i + 2];
    if (
      typeof num === 'number' &&
      Number.isInteger(num) &&
      typeof gen === 'number' &&
      Number.isInteger(gen) &&
      isName(marker) &&
      marker.name === 'R'
    ) {
      out.push({ num, gen });
      i += 2;
      continue;
    }
    out.push(num as PdfValue);
  }
  return out;
}

/**
 * Reads one object starting at `at`.
 *
 * `R` is returned as a name so `collapseRefs` can recognise the triple; no
 * real PDF uses a bare `/R` where an object is expected.
 */
export function parseObject(bytes: Uint8Array, at: number): Parsed {
  const i = skipSpace(bytes, at);
  const byte = bytes[i];
  if (byte === undefined) return { value: null, end: i };
  if (byte === 0x2f) return readName(bytes, i);
  if (byte === 0x28) return readLiteralString(bytes, i);
  if (byte === 0x5b) return readArray(bytes, i);
  if (byte === 0x3c && bytes[i + 1] === 0x3c) return readDict(bytes, i);
  if (byte === 0x3c) return readHexString(bytes, i);

  const token = readNumberToken(bytes, i);
  if (token.text === '') return { value: null, end: i + 1 };
  if (token.text === 'true') return { value: true, end: token.end };
  if (token.text === 'false') return { value: false, end: token.end };
  if (token.text === 'null') return { value: null, end: token.end };
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(token.text)) {
    return { value: Number.parseFloat(token.text), end: token.end };
  }
  return { value: { name: token.text }, end: token.end };
}

/** Reads a sequence of objects, collapsing indirect references. */
export function parseObjects(bytes: Uint8Array, at: number, limit: number): PdfValue[] {
  const items: PdfValue[] = [];
  let i = at;
  while (i < bytes.length && items.length < limit) {
    const next = skipSpace(bytes, i);
    if (next >= bytes.length) break;
    const parsed = parseObject(bytes, next);
    if (parsed.end === next) break;
    items.push(parsed.value);
    i = parsed.end;
  }
  return collapseRefs(items);
}
