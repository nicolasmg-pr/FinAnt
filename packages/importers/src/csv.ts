/**
 * Minimal RFC 4180 CSV reader. Bank and spreadsheet exports quote inconsistently,
 * embed newlines inside quoted description fields, and pick whichever delimiter
 * the locale prefers — a naive `split(',')` corrupts roughly every statement
 * that mentions an amount in Spanish or German.
 */
export interface CsvTable {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly delimiter: string;
}

const CANDIDATE_DELIMITERS = [';', ',', '\t', '|'] as const;

/** Picks the delimiter that yields the most consistent column count. */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 20);
  let best = ',';
  let bestScore = -1;
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = sample.map((line) => splitLine(line, delimiter).length);
    const modal = counts.length ? mode(counts) : 0;
    if (modal < 2) continue;
    const consistency = counts.filter((c) => c === modal).length / counts.length;
    const score = consistency * 10 + modal;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

function mode(values: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
}

function splitLine(line: string, delimiter: string): string[] {
  return parse(line, delimiter).rows[0] ?? [];
}

interface ParsedCsv {
  rows: string[][];
}

function parse(text: string, delimiter: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // Strip a UTF-8 BOM: Excel writes one, and it silently poisons the first header.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows };
}

/**
 * Reads a CSV into a header plus data rows. `headerRow` skips the preamble
 * blocks that Spanish and German banks put above the real table (account
 * holder, IBAN, date range).
 */
export function readCsv(text: string, options: { delimiter?: string; headerRow?: number } = {}): CsvTable {
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const all = parse(text, delimiter).rows.filter((r) => r.some((c) => c.trim() !== ''));
  const headerIndex = options.headerRow ?? 0;
  const header = (all[headerIndex] ?? []).map((c) => c.trim());
  return { header, rows: all.slice(headerIndex + 1), delimiter };
}
