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
  /** Index of the header among the non-empty rows, after any preamble. */
  readonly headerRow: number;
  /**
   * 1-based line in the source file for each data row, so an issue can name
   * the line the owner sees in their editor. Blank lines and the newlines
   * inside quoted fields both shift this away from the row index.
   */
  readonly rowLines: readonly number[];
}

const CANDIDATE_DELIMITERS = [';', ',', '\t', '|'] as const;

/** Picks the delimiter that yields the most consistent column count. */
export function detectDelimiter(text: string): string {
  const sample = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, 20);
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
  /** 1-based source line each row starts on. */
  lines: number[];
}

function parse(text: string, delimiter: string): ParsedCsv {
  const rows: string[][] = [];
  const lines: number[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  let line = 1;
  let rowLine = 1;

  // Strip a UTF-8 BOM: Excel writes one, and it silently poisons the first header.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '\n') line += 1;
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
      lines.push(rowLine);
      row = [];
      field = '';
      i += 1;
      line += 1;
      rowLine = line;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
    lines.push(rowLine);
  }
  return { rows, lines };
}

/**
 * Reads a CSV into a header plus data rows. `headerRow` skips the preamble
 * blocks that Spanish and German banks put above the real table (account
 * holder, IBAN, date range).
 */
export function readCsv(
  text: string,
  options: { delimiter?: string; headerRow?: number } = {},
): CsvTable {
  const { rows, lines, delimiter } = readRows(text, options);
  const headerRow = options.headerRow ?? 0;
  const header = (rows[headerRow] ?? []).map((c) => c.trim());
  return {
    header,
    rows: rows.slice(headerRow + 1),
    delimiter,
    headerRow,
    rowLines: lines.slice(headerRow + 1),
  };
}

/**
 * Every non-empty row with the line it came from, before a header is chosen.
 * Header discovery needs to look at the rows to decide which one is the header,
 * so it cannot go through `readCsv`, which needs that answer up front.
 */
export function readRows(
  text: string,
  options: { delimiter?: string } = {},
): { rows: readonly (readonly string[])[]; lines: readonly number[]; delimiter: string } {
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const parsed = parse(text, delimiter);
  const rows: string[][] = [];
  const lines: number[] = [];
  parsed.rows.forEach((row, i) => {
    if (!row.some((c) => c.trim() !== '')) return;
    rows.push(row);
    lines.push(parsed.lines[i] ?? i + 1);
  });
  return { rows, lines, delimiter };
}
