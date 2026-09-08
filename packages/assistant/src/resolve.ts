import {
  EMPTY_FILTER,
  DATE_RANGE_PRESETS,
  addMonths,
  dateRangePreset,
  isValidISODate,
  lastOfMonth,
  parseDecimal,
  yearMonthOf,
} from '@finant/core';
import type { DateRangePreset, ISODate, TransactionFilter } from '@finant/core';
import {
  AGGREGATE_KINDS,
  SIDE_VALUES,
  type AggregateKind,
  type AskContext,
  type AskIssue,
  type AskState,
  type FilterPatch,
  type RangeIntent,
} from './schema';

export const INITIAL_STATE: AskState = { filter: EMPTY_FILTER, aggregate: 'none' };

export interface Resolution {
  readonly state: AskState;
  readonly issues: readonly AskIssue[];
}

/* -------------------------------------------------------------------------- */
/* Reading what the model produced                                            */
/* -------------------------------------------------------------------------- */

/**
 * The JSON object inside whatever the model emitted.
 *
 * Grammar sampling makes bare JSON overwhelmingly likely, but a model that has
 * been told to be helpful all its life still occasionally opens with "Sure!" or
 * wraps the object in a fence. Taking the outermost braces costs nothing and
 * turns a failed turn into a working one.
 */
function extractObject(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function readRange(value: unknown, issues: AskIssue[]): RangeIntent | undefined {
  if (typeof value !== 'object' || value === null) {
    issues.push({ kind: 'bad-field', field: 'range' });
    return undefined;
  }
  const range = value as Record<string, unknown>;
  switch (range.kind) {
    case 'preset':
      if (DATE_RANGE_PRESETS.includes(range.preset as never)) {
        return { kind: 'preset', preset: range.preset as DateRangePreset };
      }
      break;
    case 'month':
      if (typeof range.yearMonth === 'string') return { kind: 'month', yearMonth: range.yearMonth };
      break;
    case 'monthsBack':
      if (typeof range.months === 'number' && Number.isFinite(range.months)) {
        return { kind: 'monthsBack', months: range.months };
      }
      break;
    case 'monthAgo':
      if (typeof range.months === 'number' && Number.isFinite(range.months)) {
        return { kind: 'monthAgo', months: range.months };
      }
      break;
    case 'explicit': {
      const from = range.from;
      const to = range.to;
      const fromOk = from === null || typeof from === 'string';
      const toOk = to === null || typeof to === 'string';
      if (fromOk && toOk) {
        return {
          kind: 'explicit',
          from: (from ?? null) as ISODate | null,
          to: (to ?? null) as ISODate | null,
        };
      }
      break;
    }
    default:
      break;
  }
  issues.push({ kind: 'bad-field', field: 'range' });
  return undefined;
}

/**
 * A patch from the model's raw output.
 *
 * A key whose type is wrong is dropped with an issue rather than failing the
 * whole turn: seven good constraints and one bad one should narrow the list
 * seven ways and say so, not throw the question away. A key the contract does
 * not define is dropped silently — that is the model padding, not an error the
 * owner can act on.
 */
export function parsePatch(raw: string): { patch: FilterPatch; issues: readonly AskIssue[] } {
  const parsed = extractObject(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { patch: {}, issues: [{ kind: 'malformed-output' }] };
  }

  const source = parsed as Record<string, unknown>;
  const issues: AskIssue[] = [];
  const patch: {
    -readonly [K in keyof FilterPatch]: FilterPatch[K];
  } = {};

  if ('text' in source) {
    if (typeof source.text === 'string' || source.text === null) patch.text = source.text;
    else issues.push({ kind: 'bad-field', field: 'text' });
  }

  for (const field of ['accountIds', 'categoryIds'] as const) {
    if (!(field in source)) continue;
    if (isStringArray(source[field])) patch[field] = source[field];
    else issues.push({ kind: 'bad-field', field });
  }

  if ('range' in source) {
    const range = readRange(source.range, issues);
    if (range !== undefined) patch.range = range;
  }

  if ('side' in source) {
    if (SIDE_VALUES.includes(source.side as never))
      patch.side = source.side as NonNullable<FilterPatch['side']>;
    else issues.push({ kind: 'bad-field', field: 'side' });
  }

  for (const field of ['minEuros', 'maxEuros'] as const) {
    if (!(field in source)) continue;
    const value = source[field];
    if (typeof value === 'string' || value === null) patch[field] = value;
    // A model that answers a euro bound with a number rather than a string is
    // still telling us the amount; the resolver parses either the same way.
    else if (typeof value === 'number' && Number.isFinite(value)) patch[field] = String(value);
    else issues.push({ kind: 'bad-field', field });
  }

  if ('aggregate' in source) {
    if (AGGREGATE_KINDS.includes(source.aggregate as never)) {
      patch.aggregate = source.aggregate as AggregateKind;
    } else issues.push({ kind: 'bad-field', field: 'aggregate' });
  }

  if ('reset' in source) {
    if (typeof source.reset === 'boolean') patch.reset = source.reset;
    else issues.push({ kind: 'bad-field', field: 'reset' });
  }

  return { patch, issues };
}

/* -------------------------------------------------------------------------- */
/* Turning it into a filter                                                   */
/* -------------------------------------------------------------------------- */

/** Bounds for an intent. `null` means the intent was unusable and the range stays put. */
function resolveRange(
  intent: RangeIntent,
  today: ISODate,
  issues: AskIssue[],
): { from: ISODate | null; to: ISODate | null } | null {
  switch (intent.kind) {
    case 'preset':
      return dateRangePreset(intent.preset, today);

    case 'month': {
      if (!/^\d{4}-\d{2}$/.test(intent.yearMonth)) {
        issues.push({ kind: 'bad-date', value: intent.yearMonth });
        return null;
      }
      return { from: `${intent.yearMonth}-01`, to: lastOfMonth(intent.yearMonth) };
    }

    case 'monthsBack': {
      // "The last three months" includes this one, which is how the filter
      // sheet's own preset reads it, so both routes land on the same bounds.
      const months = Math.max(1, Math.round(intent.months));
      const current = yearMonthOf(today);
      return { from: `${addMonths(current, -(months - 1))}-01`, to: `${current}-31` };
    }

    case 'monthAgo': {
      const ym = addMonths(yearMonthOf(today), -Math.max(0, Math.round(intent.months)));
      return { from: `${ym}-01`, to: lastOfMonth(ym) };
    }

    case 'explicit': {
      for (const bound of [intent.from, intent.to]) {
        if (bound !== null && !isValidISODate(bound)) {
          issues.push({ kind: 'bad-date', value: bound });
          return null;
        }
      }
      return { from: intent.from, to: intent.to };
    }
  }
}

/**
 * A euro bound as minor units.
 *
 * Stored as a magnitude, matching `TransactionFilter`: the bound is compared
 * against `Math.abs(tx.amount.minor)`, so a model that helpfully signs "over
 * 50 euros of spending" as -50 cannot invert the comparison.
 */
function resolveEuros(value: string, currency: string, issues: AskIssue[]): number | null {
  try {
    return Math.abs(parseDecimal(value, currency).minor);
  } catch {
    issues.push({ kind: 'bad-amount', value });
    return null;
  }
}

/** Ids the owner has, in the order the model gave them. */
function keepKnown(
  requested: readonly string[],
  known: readonly string[],
  kind: 'unknown-category' | 'unknown-account',
  issues: AskIssue[],
): string[] {
  const kept: string[] = [];
  for (const id of requested) {
    if (known.includes(id)) kept.push(id);
    else issues.push({ kind, id } as AskIssue);
  }
  return kept;
}

/**
 * The previous selection plus one turn's patch.
 *
 * Nothing here trusts the model with a value it could get wrong quietly. Ids
 * are checked against what the owner has, dates go through `core/dates`,
 * amounts through `core/money`, and anything that does not survive that is
 * reported rather than dropped on the floor.
 */
export function applyPatch(previous: AskState, patch: FilterPatch, ctx: AskContext): Resolution {
  const issues: AskIssue[] = [];
  const base = patch.reset === true ? INITIAL_STATE : previous;

  const filter: {
    -readonly [K in keyof TransactionFilter]: TransactionFilter[K];
  } = { ...base.filter };

  if (patch.text !== undefined) filter.text = patch.text ?? '';

  if (patch.categoryIds !== undefined) {
    const kept = keepKnown(patch.categoryIds, ctx.categoryIds, 'unknown-category', issues);
    // An empty array is how "every category" is said; an array that was
    // emptied by validation is a model mistake, and silently widening the
    // selection would be the wrong way to report it.
    if (patch.categoryIds.length === 0 || kept.length > 0) filter.categoryIds = kept;
  }

  if (patch.accountIds !== undefined) {
    const kept = keepKnown(patch.accountIds, ctx.accountIds, 'unknown-account', issues);
    if (patch.accountIds.length === 0 || kept.length > 0) filter.accountIds = kept;
  }

  if (patch.range !== undefined) {
    const range = resolveRange(patch.range, ctx.today, issues);
    if (range !== null) {
      filter.from = range.from;
      filter.to = range.to;
    }
  }

  if (patch.side !== undefined) filter.side = patch.side;

  if (patch.minEuros !== undefined) {
    if (patch.minEuros === null) filter.minMinor = null;
    else {
      const minor = resolveEuros(patch.minEuros, ctx.currency, issues);
      if (minor !== null) filter.minMinor = minor;
    }
  }

  if (patch.maxEuros !== undefined) {
    if (patch.maxEuros === null) filter.maxMinor = null;
    else {
      const minor = resolveEuros(patch.maxEuros, ctx.currency, issues);
      if (minor !== null) filter.maxMinor = minor;
    }
  }

  const aggregate = patch.aggregate ?? base.aggregate;

  return { state: { filter, aggregate }, issues };
}
