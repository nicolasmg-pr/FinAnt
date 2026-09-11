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

/**
 * Trade Republic's transaction export, as a CSV.
 *
 * English headers, one signed `amount` column, and — unlike every other export
 * FinAnt reads — explicit columns for the security behind a row. That is what
 * makes a portfolio reconstructable at all: the shares, the unit price and the
 * ISIN are stated, never inferred from the narrative.
 *
 * Three things about the file are easy to get wrong, and all three are
 * confirmed against a real export:
 *
 * - `DIVIDEND` writes the holding *at the time of payment* into `shares`. It is
 *   not an acquisition. `kindMap` files it as `dividend`, and `applyProfile`
 *   reads no share count for that kind.
 * - `BENEFITS_SAVEBACK` and `STOCKPERK` credit cash with an asset named but
 *   `shares` blank; the broker books a separate `BUY` moments later that
 *   carries the shares. Counting the credit as an acquisition double-counts.
 * - `description` is blank on most trade rows, so the security's name is the
 *   fallback — `descriptionFallback` rather than the generic '(no description)'.
 *
 * Every other `type` value falls through to the ordinary cash path untouched.
 *
 * Documented in docs/import-formats.md.
 */
export const TRADE_REPUBLIC_CSV: ImportProfile = {
  id: 'trade-republic-csv',
  label: 'Trade Republic — transactions (CSV)',
  // ISO dates in a dedicated `date` column; `datetime` beside it is a UTC
  // instant, which must never decide a booking date — it moves a 1 March
  // booking into February west of UTC.
  dateFormat: 'YYYY-MM-DD',
  decimalSeparator: '.',
  defaultCurrency: 'EUR',
  signConvention: 'signed',
  columns: {
    bookingDate: { header: 'date' },
    description: { header: 'description' },
    descriptionFallback: { header: 'name' },
    counterparty: { header: 'counterparty_name' },
    reference: { header: 'payment_reference' },
    amount: { header: 'amount' },
    currency: { header: 'currency' },
    externalId: { header: 'transaction_id' },
    investment: {
      kind: { header: 'type' },
      assetSymbol: { header: 'symbol' },
      assetName: { header: 'name' },
      assetClass: { header: 'asset_class' },
      shares: { header: 'shares' },
      unitPrice: { header: 'price' },
      fee: { header: 'fee' },
      kindMap: {
        BUY: 'buy',
        SELL: 'sell',
        DIVIDEND: 'dividend',
        BENEFITS_SAVEBACK: 'benefit',
        STOCKPERK: 'benefit',
      },
      assetClassMap: { FUND: 'fund', STOCK: 'stock', CRYPTO: 'crypto' },
    },
  },
  // `asset_class` and `transaction_id` together appear in no other export we
  // read, so detection cannot confuse this with a generic CSV.
  detectHeaders: ['asset_class', 'shares', 'transaction_id'],
};
