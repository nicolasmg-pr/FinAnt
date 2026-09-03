import type { CategoryRule, RuleMatch } from './types';

/**
 * Shipped rules for the euro area, keyed on merchant names as they appear in
 * ES / DE / EN statements. Priorities: shipped rules sit at 100-400, learned
 * rules from the device owner at 1000, so a manual correction always wins.
 *
 * Rules are matched against the normalised narrative (see normalise.ts), so
 * write values lowercase and without diacritics.
 */
function contains(values: readonly string[]): RuleMatch {
  return { kind: 'any', of: values.map((value) => ({ kind: 'contains', field: 'any', value })) };
}

function rule(id: string, categoryId: string, priority: number, match: RuleMatch): CategoryRule {
  return { id, categoryId, priority, enabled: true, learned: false, match };
}

export const DEFAULT_RULES: readonly CategoryRule[] = [
  // Income — narrow, and always guarded by direction so a refund of a salary
  // advance does not read as income.
  rule('r-salary', 'income-salary', 400, {
    kind: 'all',
    of: [
      { kind: 'direction', value: 'income' },
      contains(['nomina', 'salario', 'payroll', 'salary', 'gehalt', 'lohn', 'bezuege']),
    ],
  }),
  rule('r-pension', 'income-benefits', 400, {
    kind: 'all',
    of: [
      { kind: 'direction', value: 'income' },
      contains(['pension', 'rente', 'seguridad social', 'arbeitsagentur', 'kindergeld', 'prestacion']),
    ],
  }),

  // Housing
  rule('r-rent', 'housing-rent', 300, contains(['alquiler', 'arrendamiento', 'miete', 'kaltmiete', 'rent payment'])),
  rule('r-mortgage', 'housing-mortgage', 300, contains(['hipoteca', 'prestamo hipotecario', 'hypothek', 'baufinanzierung', 'mortgage'])),
  rule('r-utilities', 'housing-utilities', 250, contains([
    'iberdrola', 'endesa', 'naturgy', 'repsol luz', 'holaluz', 'totalenergies',
    'stadtwerke', 'vattenfall', 'eon', 'e on', 'rwe', 'yello strom', 'enbw',
    'canal de isabel', 'aguas', 'wasserwerke', 'electricidad', 'strom', 'gas',
  ])),
  rule('r-telco', 'housing-internet', 250, contains([
    'movistar', 'vodafone', 'orange', 'telefonica', 'yoigo', 'masmovil', 'digi',
    'telekom', 'o2', 'congstar', '1und1', 'pyur', 'unitymedia',
  ])),

  // Groceries — the highest-volume category, so worth a long list.
  rule('r-groceries', 'food-groceries', 250, contains([
    'mercadona', 'carrefour', 'lidl', 'aldi', 'dia ', 'eroski', 'alcampo', 'consum',
    'ahorramas', 'supercor', 'el corte ingles supermercado', 'bonarea', 'condis',
    'rewe', 'edeka', 'penny', 'netto', 'kaufland', 'real ', 'norma', 'tegut',
    'denns', 'alnatura', 'bio company', 'supermercado', 'supermarkt', 'getranke',
  ])),
  rule('r-restaurants', 'food-restaurants', 200, contains([
    'restaurante', 'restaurant', 'cafeteria', 'cafe ', 'bar ', 'gaststatte',
    'mcdonalds', 'burger king', 'kfc', 'telepizza', 'dominos', 'starbucks',
    'glovo', 'just eat', 'uber eats', 'deliveroo', 'lieferando', 'wolt', 'too good to go',
  ])),

  // Transport
  rule('r-transport-public', 'transport-public', 250, contains([
    'renfe', 'emt ', 'metro de', 'tmb', 'crtm', 'alsa', 'flixbus', 'blablacar',
    'deutsche bahn', 'db vertrieb', 'db fernverkehr', 'bvg', 'mvg', 'hvv', 'rmv', 'vrr', 'vbb',
  ])),
  rule('r-fuel', 'transport-car', 250, contains([
    'repsol', 'cepsa', 'galp', 'shell', 'bp ', 'aral', 'jet tankstelle', 'esso',
    'petronor', 'ballenoil', 'plenoil', 'tankstelle', 'gasolinera', 'autobahn',
    'parkhaus', 'parking', 'aparcamiento', 'itv ', 'taller',
  ])),
  rule('r-travel', 'transport-travel', 200, contains([
    'ryanair', 'vueling', 'iberia', 'lufthansa', 'eurowings', 'easyjet', 'air europa',
    'booking com', 'airbnb', 'hotel', 'hostel', 'expedia', 'edreams', 'kiwi com', 'trip com',
  ])),

  // Recurring commitments
  rule('r-subscriptions', 'subscriptions', 300, contains([
    'netflix', 'spotify', 'disney plus', 'hbo', 'max help', 'amazon prime', 'prime video',
    'apple com bill', 'itunes', 'google storage', 'youtube premium', 'dropbox', 'icloud',
    'openai', 'anthropic', 'github', 'notion', 'adobe', 'microsoft 365', 'dazn', 'movistar plus',
  ])),
  rule('r-insurance', 'insurance', 300, contains([
    'seguro', 'seguros', 'mapfre', 'mutua', 'axa', 'allianz', 'generali', 'zurich',
    'linea directa', 'adeslas', 'sanitas', 'dkv', 'huk coburg', 'ergo', 'debeka',
    'versicherung', 'krankenkasse', 'aok', 'tk ', 'barmer', 'techniker krankenkasse',
  ])),

  // Insurance splits three ways, and these two sit *above* r-insurance so a
  // health or car policy is not swallowed by the "versicherung" / "seguro" the
  // narrative shares with every other policy. Keyed on the words a statement
  // uses, never on insurer brand names: Spanish and German insurers all sell
  // every kind of policy, so a brand match would file a home policy as a car
  // one. Movements already filed under `insurance` stay there.
  rule('r-insurance-health', 'insurance-health', 320, contains([
    'krankenversicherung', 'krankenkasse', 'kranken zusatzversicherung',
    'seguro de salud', 'seguro medico', 'health insurance',
  ])),
  rule('r-insurance-car', 'insurance-car', 320, contains([
    'kfz versicherung', 'autoversicherung', 'kraftfahrzeugversicherung',
    'seguro de coche', 'seguro de auto', 'seguro del coche', 'car insurance',
  ])),
  rule('r-health', 'health-medical', 250, contains([
    'farmacia', 'apotheke', 'clinica', 'klinik', 'hospital', 'dentista', 'zahnarzt',
    'arztpraxis', 'optica', 'fielmann', 'medico', 'praxis',
  ])),
  rule('r-sport', 'sport', 200, contains([
    'gimnasio', 'gym', 'fitness', 'basic fit', 'mcfit', 'urban sports', 'clever fit',
    'decathlon', 'padel', 'piscina', 'schwimmbad',
  ])),
  rule('r-education', 'education', 200, contains([
    'universidad', 'universitat', 'universitaet', 'colegio', 'escuela', 'schule',
    'academia', 'volkshochschule', 'matricula', 'studiengebuhr', 'udemy', 'coursera',
  ])),

  // Discretionary
  rule('r-shopping', 'shopping', 150, contains([
    'amazon', 'amzn', 'zalando', 'el corte ingles', 'zara', 'h m ', 'primark', 'mango',
    'media markt', 'saturn', 'fnac', 'ikea', 'leroy merlin', 'obi ', 'bauhaus',
    'aliexpress', 'shein', 'temu', 'otto ', 'about you',
  ])),
  rule('r-leisure', 'leisure', 150, contains([
    'cine', 'cinema', 'kino', 'teatro', 'theater', 'museo', 'museum', 'eventim',
    'ticketmaster', 'entradas', 'steam games', 'playstation', 'nintendo', 'xbox',
  ])),

  // Money movement — high priority, these must never fall into a spending bucket.
  rule('r-taxes', 'taxes', 350, contains([
    'agencia tributaria', 'aeat', 'hacienda', 'impuesto', 'irpf', 'iva ',
    'finanzamt', 'steuer', 'grundsteuer', 'kfz steuer', 'rundfunkbeitrag',
    'ayuntamiento', 'tasa municipal',
  ])),
  rule('r-fees', 'fees-interest', 350, contains([
    'comision', 'comisiones', 'gastos de mantenimiento', 'intereses',
    'kontofuhrung', 'kontofuehrungsentgelt', 'entgelt', 'zinsen', 'sollzinsen',
    'bank fee', 'service charge',
  ])),
  rule('r-cash', 'cash', 350, contains([
    'reintegro', 'retirada efectivo', 'cajero', 'bargeldauszahlung', 'geldautomat',
    'atm ', 'cash withdrawal',
  ])),
  rule('r-savings', 'savings', 300, contains([
    'aportacion fondo', 'plan de pensiones', 'indexa', 'myinvestor', 'trade republic',
    'scalable capital', 'degiro', 'interactive brokers', 'etoro', 'coinbase',
    'sparplan', 'depot', 'wertpapier', 'fondsanteile',
  ])),
  rule('r-internal', 'transfer-internal', 380, contains([
    'traspaso entre cuentas', 'transferencia propia', 'umbuchung', 'eigenubertrag',
    'own transfer', 'internal transfer',
  ])),
];
