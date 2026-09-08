import { money, toDecimalString } from '@finant/core';
import type { ISODate } from '@finant/core';
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
    'Emit only the keys you are changing. A key you leave out stays as it is, so a',
    'follow-up like "and in July?" is just the range. To clear something, say it:',
    'null for text and the amount bounds, [] for the id lists. Set "reset": true when',
    'the question starts over rather than narrowing what is already selected.',
    '',
    'Keys:',
    '  text         words to look for in a movement, or null',
    `  side         one of ${SIDE_VALUES.join(', ')}`,
    '  categoryIds  ids from the category list above, [] for all',
    '  accountIds   ids from the account list above, [] for all',
    '  minEuros     lower bound on the size of a movement, in euros, as a string like "50"',
    '  maxEuros     upper bound, same form',
    `  aggregate    one of ${AGGREGATE_KINDS.join(', ')} — what the owner asked to know`,
    '  range        one of the four forms below',
    '',
    'Never work out a date yourself. Name the window and it will be resolved for you:',
    '  {"kind":"preset","preset":"this-month"}      also last-3-months, this-year, all',
    '  {"kind":"month","yearMonth":"2026-07"}       one named month',
    '  {"kind":"monthsBack","months":3}             the last N months, this one included',
    '  {"kind":"explicit","from":"2026-05-01","to":null}   only when exact days were given',
    '',
    'Never work out an amount either. Write euros exactly as the question did: "50",',
    '"12.50". Do not convert to cents and do not add a currency symbol.',
    '',
    'Use only ids that appear in the lists above. If the question names something that',
    'is not there, put the words in "text" instead of inventing an id.',
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

interface OutputSchema {
  readonly type: 'object';
  readonly additionalProperties: false;
  readonly properties: {
    readonly text: { readonly type: readonly ['string', 'null'] };
    readonly accountIds: { readonly type: 'array'; readonly items: EnumSchema };
    readonly categoryIds: { readonly type: 'array'; readonly items: EnumSchema };
    readonly range: { readonly type: 'object' };
    readonly side: EnumSchema;
    readonly minEuros: { readonly type: readonly ['string', 'null'] };
    readonly maxEuros: { readonly type: readonly ['string', 'null'] };
    readonly aggregate: EnumSchema;
    readonly reset: { readonly type: 'boolean' };
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
      range: { type: 'object' },
      side: { type: 'string', enum: SIDE_VALUES },
      minEuros: { type: ['string', 'null'] },
      maxEuros: { type: ['string', 'null'] },
      aggregate: { type: 'string', enum: AGGREGATE_KINDS },
      reset: { type: 'boolean' },
    },
  };
}
