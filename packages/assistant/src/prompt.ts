import { DATE_RANGE_PRESETS, money, toDecimalString, type ISODate } from '@finant/core';
import { AGGREGATE_KINDS, SIDE_VALUES, type AskState } from './schema';

/**
 * What the model is allowed to know about a category and an account: an id to
 * choose and a label to recognise it by.
 *
 * These types are deliberately narrower than `Category` and `Account`. A
 * movement, an IBAN, a balance or a narrative cannot reach the model without
 * widening them, which is an API change a reviewer sees rather than a leak
 * nobody notices.
 */
export interface PromptCategory {
  readonly id: string;
  readonly name: string;
}

export interface PromptAccount {
  readonly id: string;
  readonly name: string;
}

export interface PromptInput {
  readonly today: ISODate;
  /** BCP 47 tag of the interface, only so the model knows what it is reading. */
  readonly locale: string;
  readonly categories: readonly PromptCategory[];
  readonly accounts: readonly PromptAccount[];
  readonly state: AskState;
  readonly message: string;
}

/**
 * The current selection in the model's own vocabulary.
 *
 * Bounds are shown in euros rather than minor units because that is what the
 * model emits: handing it 5000 and expecting "50" back invites it to reason
 * about the conversion, which is precisely the arithmetic this design keeps
 * away from it.
 */
function describeState(state: AskState, currency: string): string {
  const { filter } = state;
  return JSON.stringify({
    text: filter.text,
    accountIds: filter.accountIds,
    categoryIds: filter.categoryIds,
    from: filter.from,
    to: filter.to,
    side: filter.side,
    minEuros: filter.minMinor === null ? null : toDecimalString(money(filter.minMinor, currency)),
    maxEuros: filter.maxMinor === null ? null : toDecimalString(money(filter.maxMinor, currency)),
    aggregate: state.aggregate,
  });
}

function describeList(items: readonly { id: string; name: string }[]): string {
  if (items.length === 0) return '  (none)';
  return items.map((item) => `  ${item.id} — ${item.name}`).join('\n');
}

/**
 * The system and user turns for one message.
 *
 * `system` is stable for the length of a conversation except for the current
 * selection, which is why the runtime keeps one context alive across turns:
 * the category and account lists are the bulk of it and re-encoding them per
 * message would dominate the latency.
 */
export function buildPrompt(input: PromptInput): { system: string; user: string } {
  const currency = 'EUR';
  const system = [
    'You turn a question about personal bank movements into a JSON patch that selects them.',
    'Reply with the JSON object only. No prose, no explanation, no code fence.',
    '',
    `Today is ${input.today}. The interface language is ${input.locale}.`,
    'The question may be written in English, Spanish or German. Understand it in whatever',
    'language it arrives; your output is always the same JSON shape.',
    '',
    'Categories:',
    describeList(input.categories),
    '',
    'Accounts:',
    describeList(input.accounts),
    '',
    'Currently selected:',
    `  ${describeState(input.state, currency)}`,
    '',
    'Emit ONLY the keys you are changing. A key you leave out stays exactly as it',
    'is. That is what makes a follow-up like "and in July?" a single key. To clear',
    'something, say so: null for text and the amount bounds, [] for the id lists.',
    '',
    'Keys:',
    '  categoryIds  ids from the category list above, [] for all',
    '  accountIds   ids from the account list above, [] for all',
    '  range        a time window, in one of the four forms below',
    `  side         one of ${SIDE_VALUES.join(', ')}`,
    '  minEuros     lower bound on the size of a movement, in euros, e.g. "50"',
    '  maxEuros     upper bound, same form',
    `  aggregate    one of ${AGGREGATE_KINDS.join(', ')}`,
    '  text         words to search for, ONLY when nothing else can express them',
    '',
    'Never work out a date yourself. Name the window and it is resolved for you:',
    '  {"kind":"preset","preset":"this-month"}   also last-3-months, this-year, all',
    '  {"kind":"month","yearMonth":"2026-07"}    one named month',
    '  {"kind":"monthsBack","months":3}          the last N months, this one included',
    '  {"kind":"monthAgo","months":1}            last month on its own; 2 = the one before',
    '  {"kind":"explicit","from":"2026-05-01","to":null}   only for exact given days',
    '',
    'Never work out an amount either. Write euros as the question did: "50", "12.50".',
    'Do not convert to cents and do not add a currency symbol.',
    '',
    'Four rules people get wrong:',
    '  1. If a category in the list covers what was asked, use categoryIds and do',
    "     NOT also put the word in text. The text search reads the bank's own",
    '     wording, which is rarely the word the question used.',
    '  2. "how much" means aggregate "sum". "how many" means "count". "on average"',
    '     means "average". Do not leave aggregate as "none" when something was asked.',
    '  3. Only use text for a shop, a person or a reference that no category covers.',
    '  4. If the question names no time window, omit range entirely. Never invent',
    '     one. The same goes for every other key: omitting it is always safe,',
    '     guessing is not.',
    '',
    'Examples, with the categories and accounts of this conversation:',
    '',
    'Q: how much did I spend on groceries in the last three months?',
    'A: {"categoryIds":["groceries"],"range":{"kind":"monthsBack","months":3},"side":"expense","aggregate":"sum"}',
    '',
    'Q: and in July?',
    'A: {"range":{"kind":"month","yearMonth":"2026-07"}}',
    '',
    'Q: how many movements were there this year?',
    'A: {"range":{"kind":"preset","preset":"this-year"},"aggregate":"count"}',
    '',
    'Q: find the payments to Lidl',
    'A: {"text":"Lidl"}',
    '',
    'Q: anything over 100 euros in July',
    'A: {"range":{"kind":"month","yearMonth":"2026-07"},"minEuros":"100"}',
    '',
    'Q: what did I pay for rent last month?',
    'A: {"categoryIds":["rent"],"range":{"kind":"monthAgo","months":1},"side":"expense","aggregate":"sum"}',
  ].join('\n');

  return { system, user: input.message };
}

/* -------------------------------------------------------------------------- */
/* Grammar                                                                    */
/* -------------------------------------------------------------------------- */

interface EnumSchema {
  readonly type: 'string';
  readonly enum: readonly string[];
}

interface RangeSchema {
  readonly anyOf: readonly object[];
}

interface OutputSchema {
  readonly type: 'object';
  readonly additionalProperties: false;
  readonly properties: {
    readonly text: { readonly type: readonly ['string', 'null'] };
    readonly accountIds: { readonly type: 'array'; readonly items: EnumSchema };
    readonly categoryIds: { readonly type: 'array'; readonly items: EnumSchema };
    readonly range: RangeSchema;
    readonly side: EnumSchema;
    readonly minEuros: { readonly type: readonly ['string', 'null'] };
    readonly maxEuros: { readonly type: readonly ['string', 'null'] };
    readonly aggregate: EnumSchema;
  };
}

/**
 * The four range shapes, spelled out.
 *
 * `{ type: 'object' }` on its own compiles to a grammar that can only produce
 * an empty object, so the model quietly never emitted a range at all and every
 * question came back unbounded in time. The alternatives have to be written out
 * for the sampler to have a path into them.
 */
function rangeSchema(): RangeSchema {
  const variant = (kind: string, properties: Record<string, unknown>) => ({
    type: 'object',
    additionalProperties: false,
    required: ['kind', ...Object.keys(properties)],
    properties: { kind: { const: kind }, ...properties },
  });

  return {
    anyOf: [
      variant('preset', { preset: { type: 'string', enum: DATE_RANGE_PRESETS } }),
      variant('month', { yearMonth: { type: 'string' } }),
      variant('monthsBack', { months: { type: 'integer' } }),
      variant('monthAgo', { months: { type: 'integer' } }),
      variant('explicit', {
        from: { type: ['string', 'null'] },
        to: { type: ['string', 'null'] },
      }),
    ],
  };
}

/**
 * The JSON Schema the runtime converts to a GBNF grammar.
 *
 * The id lists go in as enums, which is the point of building this per
 * conversation rather than shipping it as a constant: with the owner's real ids
 * as the only alternatives the decoder can take, an invented category is not
 * rejected after the fact — it cannot be produced. `resolve.ts` still checks,
 * because the grammar is a property of one runtime and the resolver is a
 * property of the contract.
 */
export function buildOutputSchema(ids: {
  readonly categoryIds: readonly string[];
  readonly accountIds: readonly string[];
}): OutputSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: ['string', 'null'] },
      accountIds: { type: 'array', items: { type: 'string', enum: ids.accountIds } },
      categoryIds: { type: 'array', items: { type: 'string', enum: ids.categoryIds } },
      range: rangeSchema(),
      side: { type: 'string', enum: SIDE_VALUES },
      minEuros: { type: ['string', 'null'] },
      maxEuros: { type: ['string', 'null'] },
      aggregate: { type: 'string', enum: AGGREGATE_KINDS },
    },
  };
}
