import { zlibSync } from 'fflate';

/**
 * Builds small but structurally real PDFs for the reader's tests.
 *
 * Hand-writing one in a fixture file is not an option here: the statements the
 * owner receives use PDF 2.0 cross-reference *streams* and compressed object
 * streams, which are binary and length-prefixed, so a text fixture cannot
 * express them. This generator produces the same shapes from a description, and
 * no real statement is ever committed.
 */

const enc = (text: string): Uint8Array => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export interface PdfObject {
  /** Object number; objects are emitted in the order given. */
  readonly num: number;
  /** The object body, as PDF syntax. */
  readonly body: string;
  /** Raw stream payload, deflated and length-stamped when present. */
  readonly stream?: Uint8Array;
  /** Put this object inside a compressed object stream. Streams cannot be. */
  readonly compressed?: boolean;
}

/**
 * Assembles a PDF with a classic `xref` table.
 *
 * `compressed` objects are ignored here — a classic table has nowhere to put
 * them — so the same object list can be built both ways and compared.
 */
export function buildClassicPdf(objects: readonly PdfObject[], trailer: string): Uint8Array {
  const parts: Uint8Array[] = [enc('%PDF-1.7\n')];
  let offset = parts[0]!.length;
  const offsets = new Map<number, number>();

  for (const object of objects) {
    offsets.set(object.num, offset);
    const chunk = objectBytes(object);
    parts.push(chunk);
    offset += chunk.length;
  }

  const highest = Math.max(...objects.map((o) => o.num));
  let table = `xref\n0 ${highest + 1}\n0000000000 65535 f \n`;
  for (let num = 1; num <= highest; num += 1) {
    const at = offsets.get(num);
    table +=
      at === undefined ? '0000000000 65535 f \n' : `${String(at).padStart(10, '0')} 00000 n \n`;
  }
  table += `trailer\n<< /Size ${highest + 1} ${trailer} >>\nstartxref\n${offset}\n%%EOF\n`;
  parts.push(enc(table));
  return concat(parts);
}

/**
 * Assembles a PDF 2.0 with a cross-reference stream and, for objects marked
 * `compressed`, an object stream. This is the shape a Flying Saucer / OpenPDF
 * statement actually has.
 */
export function buildModernPdf(objects: readonly PdfObject[], trailer: string): Uint8Array {
  const inStream = objects.filter((o) => o.compressed && !o.stream);
  const direct = objects.filter((o) => !o.compressed || o.stream);
  const highest = Math.max(...objects.map((o) => o.num)) + 2;
  const objStmNum = highest - 1;
  const xrefNum = highest;

  const parts: Uint8Array[] = [enc('%PDF-2.0\n')];
  let offset = parts[0]!.length;
  const offsets = new Map<number, number>();
  const inObjStm = new Map<number, number>();

  for (const object of direct) {
    offsets.set(object.num, offset);
    const chunk = objectBytes(object);
    parts.push(chunk);
    offset += chunk.length;
  }

  if (inStream.length > 0) {
    // An object stream is a header of "num offset" pairs, then the bodies.
    let bodies = '';
    let header = '';
    for (const object of inStream) {
      inObjStm.set(object.num, header.split(' ').filter(Boolean).length / 2);
      header += `${object.num} ${bodies.length} `;
      bodies += `${object.body} `;
    }
    const payload = enc(`${header}\n${bodies}`);
    const deflated = zlibSync(payload);
    offsets.set(objStmNum, offset);
    const chunk = concat([
      enc(
        `${objStmNum} 0 obj\n<< /Type /ObjStm /N ${inStream.length} /First ${header.length + 1} ` +
          `/Length ${deflated.length} /Filter /FlateDecode >>\nstream\n`,
      ),
      deflated,
      enc('\nendstream\nendobj\n'),
    ]);
    parts.push(chunk);
    offset += chunk.length;
  }

  // Cross-reference stream: three columns, widths 1/4/2.
  const rows: number[][] = [[0, 0, 65535]];
  for (let num = 1; num < xrefNum; num += 1) {
    const at = offsets.get(num);
    const slot = inObjStm.get(num);
    if (at !== undefined) rows.push([1, at, 0]);
    else if (slot !== undefined) rows.push([2, objStmNum, slot]);
    else rows.push([0, 0, 0]);
  }
  rows.push([1, offset, 0]);

  const entries = new Uint8Array(rows.length * 7);
  rows.forEach((row, i) => {
    const base = i * 7;
    entries[base] = row[0]!;
    entries[base + 1] = (row[1]! >>> 24) & 0xff;
    entries[base + 2] = (row[1]! >>> 16) & 0xff;
    entries[base + 3] = (row[1]! >>> 8) & 0xff;
    entries[base + 4] = row[1]! & 0xff;
    entries[base + 5] = (row[2]! >>> 8) & 0xff;
    entries[base + 6] = row[2]! & 0xff;
  });
  const deflated = zlibSync(entries);
  parts.push(
    concat([
      enc(
        `${xrefNum} 0 obj\n<< /Type /XRef /Size ${xrefNum + 1} /W [1 4 2] ` +
          `/Filter /FlateDecode /Length ${deflated.length} ${trailer} >>\nstream\n`,
      ),
      deflated,
      enc(`\nendstream\nendobj\nstartxref\n${offset}\n%%EOF\n`),
    ]),
  );
  return concat(parts);
}

function objectBytes(object: PdfObject): Uint8Array {
  if (!object.stream) return enc(`${object.num} 0 obj\n${object.body}\nendobj\n`);
  const deflated = zlibSync(object.stream);
  return concat([
    enc(
      `${object.num} 0 obj\n${object.body.replace(
        '>>',
        `/Length ${deflated.length} /Filter /FlateDecode >>`,
      )}\nstream\n`,
    ),
    deflated,
    enc('\nendstream\nendobj\n'),
  ]);
}

export { enc as pdfBytes };
