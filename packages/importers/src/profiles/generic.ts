import type { ImportProfile } from '../profile';

/**
 * Last-resort mapping that matches the header names most European exports use,
 * in English, Spanish and German. Tried only when no specific profile matches;
 * the app then shows the mapping so the owner can correct it before saving.
 */
export const GENERIC_CSV: ImportProfile = {
  id: 'generic-csv',
  label: 'Generic bank CSV',
  dateFormat: 'auto',
  decimalSeparator: 'auto',
  defaultCurrency: 'EUR',
  columns: {
    bookingDate: {
      headerAny: ['fecha operacion', 'fecha contable', 'fecha', 'buchungstag', 'buchungsdatum', 'datum', 'booking date', 'date'],
    },
    valueDate: { headerAny: ['fecha valor', 'wertstellung', 'valuta', 'value date'] },
    description: {
      headerAny: ['concepto', 'descripcion', 'verwendungszweck', 'buchungstext', 'description', 'details', 'narrative'],
    },
    counterparty: {
      headerAny: ['beneficiario', 'ordenante', 'beguenstigter', 'zahlungsempfaenger', 'auftraggeber', 'counterparty', 'payee', 'merchant'],
    },
    reference: { headerAny: ['referencia', 'mandatsreferenz', 'reference', 'kundenreferenz'] },
    amount: { headerAny: ['importe', 'betrag', 'amount', 'monto'] },
    debit: { headerAny: ['cargo', 'debe', 'soll', 'debit', 'salida'] },
    credit: { headerAny: ['abono', 'haber', 'haben', 'credit', 'entrada'] },
    currency: { headerAny: ['divisa', 'moneda', 'waehrung', 'currency'] },
    balance: { headerAny: ['saldo', 'kontostand', 'balance'] },
  },
  signConvention: 'signed',
};
