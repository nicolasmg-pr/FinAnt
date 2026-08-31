/**
 * Bank narratives are noisy and locale-dependent. Every match runs against a
 * normalised form so that "CAFÉ MARÍA", "cafe maria" and "CAFE  MARIA*ES" all
 * collapse to the same string. Diacritic stripping matters here: Spanish and
 * German statements are inconsistent about them within the same bank.
 */
export function normalise(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Noise tokens that carry no merchant identity, in the three supported languages. */
const NOISE = new Set([
  'compra', 'tarj', 'tarjeta', 'pago', 'recibo', 'transferencia', 'traspaso', 'bizum',
  'adeudo', 'domiciliacion', 'con', 'de', 'del', 'la', 'el', 'en', 'por',
  'kartenzahlung', 'lastschrift', 'ueberweisung', 'uberweisung', 'dauerauftrag',
  'einzugsermaechtigung', 'gutschrift', 'entgelt', 'karte', 'kauf', 'auftrag',
  'payment', 'card', 'purchase', 'direct', 'debit', 'transfer', 'ref', 'reference',
  'sepa', 'visa', 'mastercard', 'maestro', 'pos', 'nr', 'no', 'id',
]);

const DATEISH = /^(\d{1,2}[-/.]\d{1,2}([-/.]\d{2,4})?|\d{4}[-/.]\d{2}[-/.]\d{2})$/;

/**
 * Best-effort merchant extraction from a raw bank narrative. Returns the
 * normalised significant tokens joined by spaces — the string learned rules and
 * recurring detection key on. Not a parser: a heuristic that is right often
 * enough to be useful and never throws.
 */
export function merchantKey(raw: string): string {
  const tokens = normalise(raw)
    .split(' ')
    .filter((t) => t.length > 1)
    .filter((t) => !NOISE.has(t))
    .filter((t) => !DATEISH.test(t))
    // A run of digits is a card, reference or amount fragment, never identity.
    .filter((t) => !/^\d+$/.test(t));
  return tokens.slice(0, 4).join(' ');
}
