import type { ImportProfile } from '../profile';

/**
 * The owner's personal Google Sheets tracker — the primary import target.
 *
 * TODO(profile): this mapping is a placeholder built from the most common
 * personal-finance sheet layout. Replace `columns`, `dateFormat`,
 * `decimalSeparator`, `signConvention` and `categoryMap` with the real ones.
 *
 * How to fill it in without guessing:
 *   1. File > Download > Comma-separated values (.csv) on the tracker.
 *   2. `npm run inspect:csv -- <path-to-export.csv>`
 *      It prints the detected delimiter, the header row, sample values per
 *      column, and a ready-to-paste profile skeleton.
 *   3. Paste the skeleton over the block below and add a fixture in
 *      tests/fixtures/ so a future sheet change fails a test, not an import.
 *
 * Sensitive: never commit a real export. tests/fixtures/ holds hand-written
 * rows only, and `fixtures/private/` is gitignored for real ones.
 */
export const GOOGLE_SHEETS_TRACKER: ImportProfile = {
  id: 'google-sheets-tracker',
  label: 'My Google Sheets tracker',

  // Personal sheets usually carry a title or totals block above the table.
  // Set to the 0-based index of the row holding the column names.
  headerRow: 0,
  dateFormat: 'auto',
  decimalSeparator: 'auto',
  defaultCurrency: 'EUR',

  columns: {
    bookingDate: { headerAny: ['fecha', 'date', 'datum'] },
    description: { headerAny: ['concepto', 'description', 'descripcion', 'detalle', 'beschreibung'] },
    counterparty: { headerAny: ['comercio', 'merchant', 'payee', 'quien', 'empresa'] },
    // A sheet with one signed column uses `amount`; a sheet with separate
    // Income / Expense columns uses the debit/credit pair below instead.
    amount: { headerAny: ['importe', 'amount', 'cantidad', 'betrag'] },
    debit: { headerAny: ['gasto', 'gastos', 'expense', 'salida', 'ausgabe'] },
    credit: { headerAny: ['ingreso', 'ingresos', 'income', 'entrada', 'einnahme'] },
    category: { headerAny: ['categoria', 'category', 'kategorie', 'tipo'] },
    notes: { headerAny: ['notas', 'notes', 'comentario', 'observaciones'] },
  },

  // Many hand-kept sheets write expenses as positive numbers in a Gasto column.
  // If yours writes them negative in a single column, switch to 'signed'.
  signConvention: 'signed',

  /**
   * Maps the labels used in the sheet's own category column onto FinAnt
   * category ids, so existing history keeps its classification instead of
   * being re-guessed by the rule engine. Keys are matched case- and
   * accent-insensitively. Extend with the exact labels from the sheet.
   */
  categoryMap: {
    // Spanish labels commonly found in personal trackers
    nomina: 'income-salary',
    sueldo: 'income-salary',
    alquiler: 'housing-rent',
    hipoteca: 'housing-mortgage',
    luz: 'housing-utilities',
    agua: 'housing-utilities',
    gas: 'housing-utilities',
    internet: 'housing-internet',
    telefono: 'housing-internet',
    supermercado: 'food-groceries',
    compra: 'food-groceries',
    restaurantes: 'food-restaurants',
    transporte: 'transport-public',
    coche: 'transport-car',
    gasolina: 'transport-car',
    viajes: 'transport-travel',
    salud: 'health-medical',
    seguros: 'insurance',
    suscripciones: 'subscriptions',
    ocio: 'leisure',
    ropa: 'shopping',
    regalos: 'gifts-donations',
    impuestos: 'taxes',
    ahorro: 'savings',
    // English
    salary: 'income-salary',
    rent: 'housing-rent',
    groceries: 'food-groceries',
    restaurants: 'food-restaurants',
    transport: 'transport-public',
    travel: 'transport-travel',
    health: 'health-medical',
    insurance: 'insurance',
    subscriptions: 'subscriptions',
    shopping: 'shopping',
    taxes: 'taxes',
    savings: 'savings',
    // German
    gehalt: 'income-salary',
    miete: 'housing-rent',
    lebensmittel: 'food-groceries',
    restaurant: 'food-restaurants',
    versicherung: 'insurance',
    steuern: 'taxes',
    sparen: 'savings',
  },

  // Left empty on purpose: this profile is chosen explicitly by the owner, not
  // auto-detected, until the real headers are known.
  detectHeaders: [],
};
