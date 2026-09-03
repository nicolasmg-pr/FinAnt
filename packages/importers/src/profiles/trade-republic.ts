import type { ImportProfile } from '../profile';
import type { PdfTableSpec } from '../pdf/table';

/** The header the movements table repeats on every page it occupies. */
export const TRADE_REPUBLIC_PDF_TABLE: PdfTableSpec = {
  headers: ['DATUM', 'TYP', 'BESCHREIBUNG', 'ZAHLUNGSEINGANG', 'ZAHLUNGSAUSGANG', 'SALDO'],
  // The running balance is the one column no movement leaves blank; the two
  // amount columns are empty on every row that is not their direction.
  anchor: 'SALDO',
  // A balance, not a footer that happens to sit under the same column. The
  // certificate's "generated on" line lands nearest SALDO and would otherwise
  // open a row with no movement in it.
  anchorPattern: /\d[.,]\d\d/,
  // The certificate ends with a second table — a trade settlement list — whose
  // columns fall near these ones and whose rows would otherwise be read as
  // movements. It has no TYP column, so requiring one draws the line.
  requiredColumns: ['DATUM', 'TYP', 'SALDO'],
};

/**
 * Trade Republic's balance-and-movements certificate, as a PDF.
 *
 * German headings whatever the filename says, and a debit/credit column pair
 * rather than one signed column: the side of the ledger comes from which of
 * `ZAHLUNGSEINGANG` and `ZAHLUNGSAUSGANG` an amount sits in, never from a sign.
 * `applyProfile` already treats a pair that way, which is why the PDF is turned
 * into a table and handed to it rather than parsed separately.
 *
 * Dates arrive as `05 Sep.` on one line and `2025` on the next; the table
 * builder joins the cell and `parseDate` reads the month name.
 *
 * Documented in docs/import-formats.md.
 */
export const TRADE_REPUBLIC_PDF: ImportProfile = {
  id: 'trade-republic-pdf',
  label: 'Trade Republic — statement (PDF)',
  dateFormat: 'auto',
  decimalSeparator: ',',
  defaultCurrency: 'EUR',
  columns: {
    bookingDate: { header: 'DATUM' },
    description: { header: 'BESCHREIBUNG' },
    // `TYP` is a small closed vocabulary — Kartentransaktion, SEPA-Lastschrift,
    // Überweisung, Handel, Zinsen, Ertrag, Bonus — so it reads as a reference
    // rather than a narrative, and the rules still match on it through `any`.
    reference: { header: 'TYP' },
    credit: { header: 'ZAHLUNGSEINGANG' },
    debit: { header: 'ZAHLUNGSAUSGANG' },
    balance: { header: 'SALDO' },
  },
  detectHeaders: TRADE_REPUBLIC_PDF_TABLE.headers,
};
