import type { ImportProfile } from '../profile';

/**
 * ING Deutschland "Umsatzanzeige" CSV, as exported from the web banking.
 * Documented in docs/import-formats.md.
 *
 * The file opens with a preamble block (IBAN, account name, period, balance)
 * and the real table starts around line 14, so it is found by scanning for the
 * header rather than by a fixed offset — ING varies the preamble by account
 * type, and a fixed row would break on the next export.
 *
 * The currency of the amount is pinned by index because the header carries two
 * identically named `Währung` columns: one for the running balance and one for
 * the amount. Resolving that by name would silently take the balance's.
 */
export const ING_UMSATZANZEIGE: ImportProfile = {
  id: 'ing-umsatzanzeige',
  label: 'ING Umsatzanzeige',
  delimiter: ';',
  dateFormat: 'DD.MM.YYYY',
  decimalSeparator: ',',
  defaultCurrency: 'EUR',
  columns: {
    // `Buchung` is the booking date; `Wertstellungsdatum` is the value date.
    // The generic profile matches the latter first, which shifts a movement
    // into the wrong month whenever the two differ.
    bookingDate: { header: 'Buchung' },
    valueDate: { header: 'Wertstellungsdatum' },
    counterparty: { header: 'Auftraggeber' },
    reference: { header: 'Buchungstext' },
    description: { header: 'Verwendungszweck' },
    amount: { header: 'Betrag' },
    currency: { index: 8 },
    balance: { header: 'Saldo' },
  },
  signConvention: 'signed',
  detectHeaders: ['Buchung', 'Wertstellungsdatum', 'Buchungstext', 'Verwendungszweck', 'Betrag'],
};
