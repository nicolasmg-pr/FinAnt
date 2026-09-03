import type { CategoryRule, RuleMatch } from './types';

/**
 * Shipped rules for the euro area, keyed on merchant names as they appear in
 * ES / DE / EN statements. Priorities: shipped rules sit at 100-400, learned
 * rules from the device owner at 1000, so a manual correction always wins.
 *
 * Rules are matched against the normalised narrative (see normalise.ts), so
 * write values lowercase and without diacritics.
 */
/**
 * Any of these merchant tokens, as whole words.
 *
 * Substring matching is wrong here and was actively harmful: "rwe" sits inside
 * "ueberweisung", so an energy supplier's token filed 66 movements — every
 * German transfer in a year of statements — as utility bills. "eon", "gas",
 * "bar" and "dia" carry the same trap. Merchant names arrive space-separated in
 * bank narratives, so whole-word matching costs nothing, and a value of several
 * words still matches as a phrase.
 */
function contains(values: readonly string[]): RuleMatch {
  return { kind: 'any', of: values.map((value) => ({ kind: 'word', field: 'any', value })) };
}

/**
 * Any of these as a substring, for the one case where whole-word matching is
 * wrong: German glues a noun onto the front of another word, so
 * `Hausratversicherung`, `Stromabschlag` and `Gehaltsabrechnung` are single
 * words a match on `versicherung`, `strom` or `gehalt` must still find.
 *
 * Only long, unambiguous nouns belong here.
 */
function compound(values: readonly string[]): RuleMatch {
  return { kind: 'any', of: values.map((value) => ({ kind: 'contains', field: 'any', value })) };
}

/** Whole-word brands, plus the German nouns that legitimately glue. */
function containsOrCompound(brands: readonly string[], nouns: readonly string[]): RuleMatch {
  return { kind: 'any', of: [contains(brands), compound(nouns)] };
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
      containsOrCompound(['nomina', 'salario', 'payroll', 'salary', 'lohn', 'bezuege'], ['gehalt']),
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
  rule('r-rent', 'housing-rent', 300,
    containsOrCompound(['alquiler', 'arrendamiento', 'rent payment'], ['miete', 'kaltmiete'])),
  rule('r-mortgage', 'housing-mortgage', 300, contains(['hipoteca', 'prestamo hipotecario', 'hypothek', 'baufinanzierung', 'mortgage'])),
  rule('r-utilities', 'housing-utilities', 250, containsOrCompound([
    'iberdrola', 'endesa', 'naturgy', 'repsol luz', 'holaluz', 'totalenergies',
    'vattenfall', 'eon', 'e on', 'rwe', 'yello strom', 'enbw',
    'canal de isabel', 'aguas', 'electricidad', 'gas',
  ], ['stadtwerke', 'wasserwerke', 'strom'])),
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
  rule('r-insurance', 'insurance', 300, containsOrCompound([
    'seguro', 'seguros', 'mapfre', 'mutua', 'axa', 'allianz', 'generali', 'zurich',
    'linea directa', 'adeslas', 'sanitas', 'dkv', 'huk coburg', 'ergo', 'debeka',
    'aok', 'tk', 'barmer', 'techniker krankenkasse',
  ], ['versicherung', 'krankenkasse'])),

  // Insurance splits three ways, and these two sit *above* r-insurance so a
  // health or car policy is not swallowed by the "versicherung" / "seguro" the
  // narrative shares with every other policy. Keyed on the words a statement
  // uses, never on insurer brand names: Spanish and German insurers all sell
  // every kind of policy, so a brand match would file a home policy as a car
  // one. Movements already filed under `insurance` stay there.
  rule('r-insurance-health', 'insurance-health', 320, containsOrCompound([
    'kranken zusatzversicherung', 'seguro de salud', 'seguro medico', 'health insurance',
  ], ['krankenversicherung', 'krankenkasse'])),
  rule('r-insurance-car', 'insurance-car', 320, containsOrCompound([
    'kfz versicherung', 'seguro de coche', 'seguro de auto', 'seguro del coche', 'car insurance',
  ], ['autoversicherung', 'kraftfahrzeugversicherung'])),
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
  rule('r-taxes', 'taxes', 350, containsOrCompound([
    'agencia tributaria', 'aeat', 'hacienda', 'impuesto', 'irpf', 'iva',
    'ayuntamiento', 'tasa municipal',
  ], ['finanzamt', 'steuer', 'rundfunkbeitrag'])),
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

/** Ids of every rule this release ships, for telling ours from a learned one. */
const SHIPPED_RULE_IDS: ReadonlySet<string> = new Set(DEFAULT_RULES.map((r) => r.id));

export function isShippedRuleId(id: string): boolean {
  return SHIPPED_RULE_IDS.has(id);
}

/**
 * Which shipped rules a database is still missing.
 *
 * Rules were installed once, on a fresh database, which meant a rule added in a
 * later release never reached a device that had already been seeded — the two
 * insurance rules would have shipped with no way of ever running. Installing
 * the missing ones on every launch fixes that, but a plain `INSERT OR IGNORE`
 * over the whole set would also bring back a rule the owner deleted, every
 * launch, forever. So a deleted shipped rule leaves a tombstone and is passed
 * in here as retired.
 *
 * Existing rules are never rewritten: the owner may have disabled or
 * re-pointed one, and that is their decision, not a drift to correct.
 */
export function shippedRulesToInstall(
  shipped: readonly CategoryRule[],
  existingIds: readonly string[],
  retiredIds: readonly string[],
): CategoryRule[] {
  const known = new Set([...existingIds, ...retiredIds]);
  return shipped.filter((rule) => !known.has(rule.id));
}

/**
 * Reads the retired-rule tombstones out of their stored form.
 *
 * A value that is not a JSON array of strings reads as no tombstones: a corrupt
 * setting must not stop the database from opening, and the worst case of
 * treating it as empty is that a deleted shipped rule comes back once.
 */
export function parseRetiredShippedRules(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
