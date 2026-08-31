import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

/**
 * Minimal XLSX reader: enough of the format to read a hand-kept budget
 * workbook, and nothing more.
 *
 * An .xlsx file is a zip of XML parts. Only three matter here: the workbook
 * (sheet names and their relationship ids), the relationships (id -> file), and
 * the shared string table (text cells are indices into it, not literals).
 *
 * Formulas are not evaluated — the cached value the spreadsheet last wrote is
 * read instead, which is what the owner actually sees on screen.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  removeNSPrefix: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  const record = node as Record<string, unknown>;
  if ('#text' in record) return String(record['#text'] ?? '');
  return '';
}

export interface Cell {
  readonly value: string;
  /** `s` = shared string, `n` = number, `b` = boolean, `str`/`inlineStr` = literal text. */
  readonly type: string;
}

/** A worksheet as a sparse map from cell reference (`B12`) to cell. */
export type SheetGrid = ReadonlyMap<string, Cell>;

export interface Workbook {
  readonly sheetNames: readonly string[];
  sheet(name: string): SheetGrid | null;
}

export function columnName(index: number): string {
  let name = '';
  let n = index;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export function ref(column: number, row: number): string {
  return `${columnName(column)}${row}`;
}

export class XlsxError extends Error {}

export function readXlsx(data: Uint8Array): Workbook {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch (error) {
    throw new XlsxError(`Not a readable .xlsx file: ${(error as Error).message}`);
  }

  const part = (path: string): string | null => {
    const entry = files[path];
    return entry ? strFromU8(entry) : null;
  };

  const workbookXml = part('xl/workbook.xml');
  if (!workbookXml) throw new XlsxError('Missing xl/workbook.xml — not a spreadsheet');

  const relsXml = part('xl/_rels/workbook.xml.rels') ?? '';
  const relationships = new Map<string, string>();
  for (const rel of asArray(
    (parser.parse(relsXml) as Record<string, any>)?.['Relationships']?.['Relationship'],
  )) {
    relationships.set(String(rel['@Id']), String(rel['@Target']).replace(/^\/?xl\//, ''));
  }

  const sharedXml = part('xl/sharedStrings.xml');
  const sharedStrings: string[] = sharedXml
    ? asArray((parser.parse(sharedXml) as Record<string, any>)?.['sst']?.['si']).map((si: any) => {
        // A string is either one <t>, or several <r> runs when it carries mixed
        // formatting. Both render as the same text to the reader.
        if (si?.['t'] !== undefined) return textOf(si['t']) || String(si['t'] ?? '');
        return asArray(si?.['r'])
          .map((run: any) => textOf(run?.['t']) || String(run?.['t'] ?? ''))
          .join('');
      })
    : [];

  const workbook = parser.parse(workbookXml) as Record<string, any>;
  const entries = asArray(workbook?.['workbook']?.['sheets']?.['sheet']).map((sheet: any) => ({
    name: String(sheet['@name']),
    file: relationships.get(String(sheet['@id'])) ?? '',
  }));

  const cache = new Map<string, SheetGrid>();

  return {
    sheetNames: entries.map((e) => e.name),
    sheet(name: string): SheetGrid | null {
      const cached = cache.get(name);
      if (cached) return cached;

      const entry = entries.find((e) => e.name === name);
      const xml = entry ? part(`xl/${entry.file}`) : null;
      if (!xml) return null;

      const grid = new Map<string, Cell>();
      const doc = parser.parse(xml) as Record<string, any>;
      for (const row of asArray(doc?.['worksheet']?.['sheetData']?.['row'])) {
        for (const cell of asArray((row as any)?.['c'])) {
          const address = String((cell as any)['@r'] ?? '');
          const type = String((cell as any)['@t'] ?? 'n');
          let value: string;

          if (type === 'inlineStr') {
            value = textOf((cell as any)['is']?.['t']) || String((cell as any)['is']?.['t'] ?? '');
          } else {
            const raw = (cell as any)['v'];
            value = textOf(raw) || (raw === undefined ? '' : String(raw));
            if (type === 's') value = sharedStrings[Number(value)] ?? '';
          }

          if (address === '' || value === '') continue;
          grid.set(address, { value, type });
        }
      }

      cache.set(name, grid);
      return grid;
    },
  };
}
