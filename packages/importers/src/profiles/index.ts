import { readCsv, readRows, type CsvTable } from '../csv';
import { extractPdfPages } from '../pdf/index';
import { pdfTable } from '../pdf/table';
import { detectProfile, findHeaderRow, type ImportProfile } from '../profile';
import type { PdfTableSpec } from '../pdf/table';
import { GENERIC_CSV } from './generic';
import { ING_UMSATZANZEIGE } from './ing';
import { TRADE_REPUBLIC_PDF, TRADE_REPUBLIC_PDF_TABLE } from './trade-republic';

export { GENERIC_CSV };
export { ING_UMSATZANZEIGE };
export { TRADE_REPUBLIC_PDF, TRADE_REPUBLIC_PDF_TABLE };
export { PRESUPUESTO_XLSX } from './presupuesto';

/**
 * CSV profiles, in detection order: specific first, generic last.
 * The `PresupuestoYYYY.xlsx` tracker is a workbook profile, not a CSV one, and
 * is applied directly rather than detected from a header row.
 */
export const BUILT_IN_PROFILES: readonly ImportProfile[] = [ING_UMSATZANZEIGE, GENERIC_CSV];

/** How far into a file the header may sit. ING's preamble is thirteen lines. */
const HEADER_SEARCH_DEPTH = 40;

/**
 * Reads a statement CSV into a table, choosing both the profile and the row the
 * header sits on.
 *
 * Bank exports put a preamble above the table — account holder, IBAN, period,
 * opening balance — so neither the profile nor the columns can be resolved from
 * row 0. Each candidate row is offered to the profiles in turn; the first that
 * recognises one wins. Falling back to the generic profile, the header is the
 * row whose width the body of the file agrees with.
 */
export function readStatementCsv(
  text: string,
  options: { profile?: ImportProfile } = {},
): { table: CsvTable; profile: ImportProfile } {
  const { rows, delimiter } = readRows(text);
  const read = (profile: ImportProfile, headerRow: number) => ({
    table: readCsv(text, { delimiter: profile.delimiter ?? delimiter, headerRow }),
    profile,
  });

  if (options.profile) {
    const forced = options.profile;
    return read(forced, forced.headerRow ?? findHeaderRow(rows, HEADER_SEARCH_DEPTH));
  }

  const depth = Math.min(rows.length, HEADER_SEARCH_DEPTH);
  for (let i = 0; i < depth; i += 1) {
    const candidate = (rows[i] ?? []).map((cell) => cell.trim());
    const match = detectProfile(candidate, BUILT_IN_PROFILES);
    if (match) return read(match, match.headerRow ?? i);
  }
  return read(GENERIC_CSV, GENERIC_CSV.headerRow ?? findHeaderRow(rows, HEADER_SEARCH_DEPTH));
}

/** PDF statement profiles, tried in order against a document's pages. */
export const BUILT_IN_PDF_PROFILES: readonly {
  readonly profile: ImportProfile;
  readonly table: PdfTableSpec;
}[] = [{ profile: TRADE_REPUBLIC_PDF, table: TRADE_REPUBLIC_PDF_TABLE }];

/**
 * Reads a PDF statement into the same table shape a CSV produces.
 *
 * A PDF carries no header row to detect a profile from, so each profile's table
 * spec is tried in turn and the first one that finds its header on a page wins.
 * A document no profile recognises raises rather than returning an empty table:
 * there is no generic fallback here, because guessing a movements table out of
 * arbitrary PDF geometry mis-reads statements silently, and a wrong amount
 * looks exactly like a right one.
 */
export function readStatementPdf(bytes: Uint8Array): {
  table: CsvTable;
  profile: ImportProfile;
} {
  const pages = extractPdfPages(bytes);
  for (const candidate of BUILT_IN_PDF_PROFILES) {
    const table = pdfTable(pages, candidate.table);
    if (table.rows.length > 0) return { table, profile: candidate.profile };
  }
  throw new Error('This PDF does not match any statement layout FinAnt can read.');
}
