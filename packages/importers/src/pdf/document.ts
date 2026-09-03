import { unzlibSync } from 'fflate';
import {
  asArray,
  asDict,
  asName,
  asNumber,
  isDict,
  isRef,
  parseObject,
  parseObjects,
  skipSpace,
  type PdfDict,
  type PdfRef,
  type PdfValue,
} from './objects';

/**
 * Document structure: the cross-reference, object streams, and the page tree.
 *
 * Only what a text-bearing statement needs. In particular this reader does not
 * decrypt, does not apply cross-reference stream predictors, and does not know
 * any stream filter but Flate. Each of those raises rather than guessing: a
 * statement read wrong is worse than one refused, because a wrong amount looks
 * exactly like a right one.
 */

interface XrefEntry {
  /** Byte offset for a plain object, or the object-stream number for a compressed one. */
  readonly at: number;
  /** Index inside the object stream, for a compressed object. */
  readonly slot?: number;
  readonly compressed: boolean;
}

export interface PdfDocument {
  readonly pages: readonly PdfDict[];
  /** Follows an indirect reference; anything else is returned unchanged. */
  resolve(value: PdfValue | undefined): PdfValue | undefined;
  /** The page's content streams, inflated and joined. */
  contentOf(page: PdfDict): Uint8Array;
  /** The page's font resources by resource name, with inheritance applied. */
  fontsOf(page: PdfDict): ReadonlyMap<string, PdfDict>;
  /** A stream object's inflated payload; empty when the value is not a stream. */
  streamOf(value: PdfValue | undefined): Uint8Array;
}

function latin1Of(bytes: Uint8Array, from: number, to: number): string {
  let out = '';
  for (let i = from; i < Math.min(to, bytes.length); i += 1) out += String.fromCharCode(bytes[i]!);
  return out;
}

/** Inflates a stream, refusing any filter chain this reader cannot honour. */
function decodeStream(dict: PdfDict, raw: Uint8Array, resolve: PdfDocument['resolve']): Uint8Array {
  const filterValue = resolve(dict.get('Filter'));
  const filters = Array.isArray(filterValue)
    ? filterValue.map((f) => asName(f))
    : [asName(filterValue)];
  const named = filters.filter((f): f is string => f !== null);
  if (named.length === 0) return raw;
  if (named.length > 1 || (named[0] !== 'FlateDecode' && named[0] !== 'Fl')) {
    throw new Error(`Unsupported PDF stream filter: ${named.join(',')}`);
  }
  const parms = asDict(resolve(dict.get('DecodeParms')));
  const predictor = asNumber(resolve(parms.get('Predictor'))) ?? 1;
  if (predictor > 1) {
    throw new Error(`Unsupported PDF stream predictor: ${predictor}`);
  }
  return unzlibSync(raw);
}

/** Reads `N` objects out of an object stream's inflated payload. */
function readObjectStream(payload: Uint8Array, count: number, first: number): PdfValue[] {
  const header = parseObjects(payload, 0, count * 2);
  const out: PdfValue[] = [];
  for (let i = 0; i < count; i += 1) {
    const offset = asNumber(header[i * 2 + 1]);
    if (offset === null) {
      out.push(null);
      continue;
    }
    out.push(parseObject(payload, first + offset).value);
  }
  return out;
}

export function openPdf(bytes: Uint8Array): PdfDocument {
  if (latin1Of(bytes, 0, 5) !== '%PDF-') {
    throw new Error('Not a PDF: the file does not start with %PDF-.');
  }

  const xref = new Map<number, XrefEntry>();
  const cache = new Map<number, PdfValue>();
  let trailer: PdfDict = new Map();

  // Declared here so the readers below can resolve references while building.
  const resolve: PdfDocument['resolve'] = (value) => {
    if (!isRef(value)) return value;
    if (cache.has(value.num)) return cache.get(value.num);
    const entry = xref.get(value.num);
    if (!entry) return undefined;
    // Guard against a cycle: a malformed file can point an object at itself.
    cache.set(value.num, null);
    const loaded = entry.compressed ? loadCompressed(entry) : loadDirect(entry);
    cache.set(value.num, loaded);
    return loaded;
  };

  function loadDirect(entry: XrefEntry): PdfValue {
    // `n g obj` precedes the body; skip the two numbers and the keyword.
    let at = skipSpace(bytes, entry.at);
    for (let token = 0; token < 3; token += 1) {
      const parsed = parseObject(bytes, at);
      at = parsed.end;
      if (asName(parsed.value) === 'obj') break;
    }
    const parsed = parseObject(bytes, at);
    if (!isDict(parsed.value)) return parsed.value;
    return attachStream(parsed.value, parsed.end);
  }

  function attachStream(dict: PdfDict, after: number): PdfValue {
    const at = skipSpace(bytes, after);
    if (latin1Of(bytes, at, at + 6) !== 'stream') return dict;
    let start = at + 6;
    if (bytes[start] === 0x0d) start += 1;
    if (bytes[start] === 0x0a) start += 1;
    const length = asNumber(resolve(dict.get('Length')));
    const end =
      length !== null && length > 0
        ? start + length
        : indexOfForwards(bytes, 'endstream', start);
    const withStream = new Map(dict);
    withStream.set('__streamStart', start);
    withStream.set('__streamEnd', end);
    return withStream;
  }

  function loadCompressed(entry: XrefEntry): PdfValue {
    const container = resolve({ num: entry.at, gen: 0 });
    if (!isDict(container)) return null;
    const payload = streamBytes(container);
    const count = asNumber(resolve(container.get('N'))) ?? 0;
    const first = asNumber(resolve(container.get('First'))) ?? 0;
    const objects = readObjectStream(payload, count, first);
    return objects[entry.slot ?? 0] ?? null;
  }

  function streamBytes(dict: PdfDict): Uint8Array {
    const start = asNumber(dict.get('__streamStart'));
    const end = asNumber(dict.get('__streamEnd'));
    if (start === null || end === null) return new Uint8Array();
    return decodeStream(dict, bytes.subarray(start, end), resolve);
  }

  readXrefChain();
  if (trailer.has('Encrypt')) {
    throw new Error('This PDF is encrypted, and FinAnt does not decrypt statements.');
  }

  function readXrefChain(): void {
    const tail = latin1Of(bytes, Math.max(0, bytes.length - 2048), bytes.length);
    const marker = /startxref\s+(\d+)/g;
    let start: number | null = null;
    for (let hit = marker.exec(tail); hit !== null; hit = marker.exec(tail)) {
      start = Number.parseInt(hit[1]!, 10);
    }
    const seen = new Set<number>();
    let at = start;
    while (at !== null && at >= 0 && at < bytes.length && !seen.has(at)) {
      seen.add(at);
      at = readXrefSection(at);
    }
    if (xref.size === 0) throw new Error('Not a PDF: no usable cross-reference was found.');
  }

  /** Reads one section and returns the offset of the previous one, if any. */
  function readXrefSection(at: number): number | null {
    const head = skipSpace(bytes, at);
    if (latin1Of(bytes, head, head + 4) === 'xref') return readXrefTable(head + 4);
    return readXrefStream(head);
  }

  function readXrefTable(at: number): number | null {
    let i = skipSpace(bytes, at);
    while (latin1Of(bytes, i, i + 7) !== 'trailer') {
      const start = parseObject(bytes, i);
      const count = parseObject(bytes, start.end);
      const first = asNumber(start.value);
      const total = asNumber(count.value);
      if (first === null || total === null) break;
      i = skipSpace(bytes, count.end);
      for (let k = 0; k < total; k += 1) {
        const line = latin1Of(bytes, i, i + 20);
        const offset = Number.parseInt(line.slice(0, 10), 10);
        const kind = line[17];
        const num = first + k;
        if (kind === 'n' && !xref.has(num)) xref.set(num, { at: offset, compressed: false });
        i += 20;
      }
      i = skipSpace(bytes, i);
    }
    const parsed = parseObject(bytes, skipSpace(bytes, i + 7));
    const dict = asDict(parsed.value);
    mergeTrailer(dict);
    // A hybrid file points at a cross-reference stream holding the rest.
    const hybrid = asNumber(dict.get('XRefStm'));
    if (hybrid !== null) readXrefSection(hybrid);
    return asNumber(dict.get('Prev'));
  }

  function readXrefStream(at: number): number | null {
    let i = skipSpace(bytes, at);
    for (let token = 0; token < 3; token += 1) {
      const parsed = parseObject(bytes, i);
      i = parsed.end;
      if (asName(parsed.value) === 'obj') break;
    }
    const parsed = parseObject(bytes, i);
    if (!isDict(parsed.value)) return null;
    const dict = asDict(attachStream(parsed.value, parsed.end));
    const payload = streamBytes(dict);

    const widths = asArray(dict.get('W')).map((w) => asNumber(w) ?? 0);
    const size = asNumber(dict.get('Size')) ?? 0;
    const index = asArray(dict.get('Index')).map((n) => asNumber(n) ?? 0);
    const ranges = index.length >= 2 ? index : [0, size];
    const rowWidth = widths.reduce((sum, w) => sum + w, 0);

    let cursor = 0;
    for (let range = 0; range + 1 < ranges.length; range += 2) {
      const first = ranges[range]!;
      const total = ranges[range + 1]!;
      for (let k = 0; k < total && cursor + rowWidth <= payload.length; k += 1) {
        const fields: number[] = [];
        for (const width of widths) {
          let value = 0;
          for (let b = 0; b < width; b += 1) {
            value = value * 256 + (payload[cursor]! ?? 0);
            cursor += 1;
          }
          fields.push(value);
        }
        // A zero-width first column means type 1, per PDF 32000-2 7.5.8.2.
        const kind = widths[0] === 0 ? 1 : fields[0]!;
        const num = first + k;
        if (!xref.has(num)) {
          if (kind === 1) xref.set(num, { at: fields[1] ?? 0, compressed: false });
          else if (kind === 2) {
            xref.set(num, { at: fields[1] ?? 0, slot: fields[2] ?? 0, compressed: true });
          }
        }
      }
    }
    mergeTrailer(dict);
    return asNumber(dict.get('Prev'));
  }

  /** Earlier sections win: the chain is walked newest first. */
  function mergeTrailer(dict: PdfDict): void {
    const merged = new Map(trailer);
    for (const [key, value] of dict) if (!merged.has(key)) merged.set(key, value);
    trailer = merged;
  }

  const pages: PdfDict[] = [];
  collectPages(asDict(resolve(asDict(resolve(trailer.get('Root'))).get('Pages'))), new Set());

  function collectPages(node: PdfDict, seen: Set<PdfDict>): void {
    if (node.size === 0 || seen.has(node) || pages.length > 5000) return;
    seen.add(node);
    const type = asName(node.get('Type'));
    if (type === 'Page') {
      pages.push(node);
      return;
    }
    for (const kid of asArray(node.get('Kids'))) {
      collectPages(asDict(resolve(kid)), seen);
    }
  }

  /** Walks up `Parent` for an attribute a page tree node may inherit. */
  function inherited(page: PdfDict, key: string): PdfValue | undefined {
    let node: PdfDict | undefined = page;
    for (let depth = 0; node && depth < 64; depth += 1) {
      const own = node.get(key);
      if (own !== undefined) return resolve(own);
      const parent = resolve(node.get('Parent'));
      node = isDict(parent) ? parent : undefined;
    }
    return undefined;
  }

  return {
    pages,
    resolve,
    contentOf(page) {
      const contents = resolve(page.get('Contents'));
      const streams = Array.isArray(contents) ? contents : [page.get('Contents')];
      const parts: Uint8Array[] = [];
      for (const item of streams) {
        const dict = resolve(item);
        if (!isDict(dict)) continue;
        parts.push(streamBytes(dict));
      }
      // A newline between parts: the array may split mid-operator, and joining
      // without one would weld two tokens into a third.
      const total = parts.reduce((sum, part) => sum + part.length, 0) + Math.max(0, parts.length - 1);
      const out = new Uint8Array(total);
      let cursor = 0;
      parts.forEach((part, i) => {
        if (i > 0) {
          out[cursor] = 0x0a;
          cursor += 1;
        }
        out.set(part, cursor);
        cursor += part.length;
      });
      return out;
    },
    streamOf(value) {
      const dict = resolve(value);
      return isDict(dict) ? streamBytes(dict) : new Uint8Array();
    },
    fontsOf(page) {
      const resources = asDict(inherited(page, 'Resources'));
      const fonts = asDict(resolve(resources.get('Font')));
      const out = new Map<string, PdfDict>();
      for (const [name, value] of fonts) {
        const font = resolve(value);
        if (isDict(font)) out.set(name, font);
      }
      return out;
    },
  };
}

function indexOfForwards(bytes: Uint8Array, needle: string, from: number): number {
  const target = [...needle].map((c) => c.charCodeAt(0));
  for (let i = from; i <= bytes.length - target.length; i += 1) {
    let hit = true;
    for (let k = 0; k < target.length; k += 1) {
      if (bytes[i + k] !== target[k]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return bytes.length;
}

export type { PdfRef };
