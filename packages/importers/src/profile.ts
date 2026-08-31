import {
  importHashOf,
  money,
  sideFromAmount,
  type CurrencyCode,
  type Money,
  type TransactionSide,
  type TransactionSource,
} from '@finant/core';
import type { CsvTable } from './csv';
import { parseAmount, parseDate, type DateFormat, type DecimalSeparator } from './values';

/** A column is addressed by header text (case/accent-insensitive) or by index. */
export type ColumnRef =
  | { readonly header: string }
  | { readonly headerAny: readonly string[] }
  | { readonly index: number };

export interface ProfileColumns {
  readonly bookingDate: ColumnRef;
  readonly valueDate?: ColumnRef;
  readonly description: ColumnRef;
  readonly counterparty?: ColumnRef;
  readonly reference?: ColumnRef;
  /** One signed column... */
  readonly amount?: ColumnRef;
  /** ...or a debit/credit pair, which most bank exports use instead. */
  readonly debit?: ColumnRef;
  readonly credit?: ColumnRef;
  readonly currency?: ColumnRef;
  /** The owner's own category label, when the file already carries one. */
  readonly category?: ColumnRef;
  readonly notes?: ColumnRef;
  readonly balance?: ColumnRef;
}

export interface ImportProfile {
  readonly id: string;
  readonly label: string;
  /** Header row index, for files with a preamble above the table. */
  readonly headerRow?: number;
  readonly delimiter?: string;
  readonly dateFormat?: DateFormat;
  readonly decimalSeparator?: DecimalSeparator;
  /** Used when no currency column exists. */
  readonly defaultCurrency?: CurrencyCode;
  readonly columns: ProfileColumns;
  /**
   * 'signed'           — the amount column is already negative for expenses.
   * 'expense-positive' — expenses are written positive and must be flipped.
   */
  readonly signConvention?: 'signed' | 'expense-positive';
  /** Maps the file's own category labels onto FinAnt category ids. */
  readonly categoryMap?: Readonly<Record<string, string>>;
  /** Headers that must all be present for auto-detection to pick this profile. */
  readonly detectHeaders?: readonly string[];
}

export interface DraftTransaction {
  readonly accountId: string;
  readonly bookingDate: string;
  readonly valueDate: string | null;
  readonly amount: Money;
  /** Which side of the ledger the row belongs to, regardless of its sign. */
  readonly side: TransactionSide;
  readonly description: string;
  readonly counterparty: string | null;
  readonly reference: string | null;
  /** From the file's own category column, before the rule engine runs. */
  readonly suggestedCategoryId: string | null;
  readonly source: TransactionSource;
  readonly externalId: string | null;
  readonly importHash: string;
  readonly notes: string | null;
}

export interface ImportIssue {
  /** 1-based, counted in the source file including the header. */
  readonly row: number;
  readonly message: string;
  readonly raw: readonly string[];
}

export interface ImportResult {
  readonly profileId: string;
  readonly transactions: readonly DraftTransaction[];
  /** Rows that could not be read. Never silently dropped — the UI shows them. */
  readonly issues: readonly ImportIssue[];
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function resolveColumn(header: readonly string[], ref: ColumnRef): number {
  if ('index' in ref) return ref.index;
  const wanted = 'header' in ref ? [ref.header] : ref.headerAny;
  for (const candidate of wanted) {
    const target = fold(candidate);
    const exact = header.findIndex((h) => fold(h) === target);
    if (exact >= 0) return exact;
  }
  for (const candidate of wanted) {
    const target = fold(candidate);
    const partial = header.findIndex((h) => fold(h).includes(target));
    if (partial >= 0) return partial;
  }
  return -1;
}

function cell(row: readonly string[], index: number): string {
  return index >= 0 ? (row[index] ?? '').trim() : '';
}

function optionalCell(row: readonly string[], header: readonly string[], ref?: ColumnRef): string {
  return ref ? cell(row, resolveColumn(header, ref)) : '';
}

/**
 * Turns a parsed CSV into draft transactions using a column-mapping profile.
 *
 * Rows that cannot be read become issues rather than exceptions: an import of
 * 400 rows must not be lost because row 212 has a merged cell.
 */
export function applyProfile(
  table: CsvTable,
  profile: ImportProfile,
  context: { accountId: string; currency?: CurrencyCode },
): ImportResult {
  const { header, rows } = table;
  const defaultCurrency = context.currency ?? profile.defaultCurrency ?? 'EUR';
  const dateFormat = profile.dateFormat ?? 'auto';
  const separator = profile.decimalSeparator ?? 'auto';

  const idx = {
    bookingDate: resolveColumn(header, profile.columns.bookingDate),
    description: resolveColumn(header, profile.columns.description),
    amount: profile.columns.amount ? resolveColumn(header, profile.columns.amount) : -1,
    debit: profile.columns.debit ? resolveColumn(header, profile.columns.debit) : -1,
    credit: profile.columns.credit ? resolveColumn(header, profile.columns.credit) : -1,
    currency: profile.columns.currency ? resolveColumn(header, profile.columns.currency) : -1,
  };

  const transactions: DraftTransaction[] = [];
  const issues: ImportIssue[] = [];
  const headerOffset = (profile.headerRow ?? 0) + 2; // 1-based, plus the header line

  rows.forEach((row, i) => {
    const rowNumber = headerOffset + i;
    const fail = (message: string) => issues.push({ row: rowNumber, message, raw: row });

    const bookingDate = parseDate(cell(row, idx.bookingDate), dateFormat);
    if (!bookingDate) {
      // A blank date is almost always a subtotal or spacer row in a spreadsheet.
      if (row.every((c) => c.trim() === '')) return;
      fail('Unreadable or missing booking date');
      return;
    }

    const currency = idx.currency >= 0 ? (cell(row, idx.currency) || defaultCurrency) : defaultCurrency;

    let amount: Money | null = null;
    // A debit/credit pair states the side explicitly; a single signed column
    // only implies it, so the side is derived from the sign in that case.
    let side: TransactionSide | null = null;

    if (idx.amount >= 0) {
      amount = parseAmount(cell(row, idx.amount), currency, separator);
      if (amount && profile.signConvention === 'expense-positive') {
        amount = money(-amount.minor, amount.currency);
      }
      if (amount) side = sideFromAmount(amount);
    } else {
      const debit = idx.debit >= 0 ? parseAmount(cell(row, idx.debit), currency, separator) : null;
      const credit = idx.credit >= 0 ? parseAmount(cell(row, idx.credit), currency, separator) : null;
      if (debit && debit.minor !== 0) {
        // Preserve the sign: a negative value in a debit column is a refund,
        // which belongs on the expense side and reduces it.
        amount = money(-debit.minor, currency);
        side = 'expense';
      } else if (credit && credit.minor !== 0) {
        amount = money(credit.minor, currency);
        side = 'income';
      }
    }
    if (!amount || !side) {
      fail('Unreadable or missing amount');
      return;
    }

    const description = cell(row, idx.description) ||
      optionalCell(row, header, profile.columns.counterparty) ||
      '(no description)';
    const rawCategory = optionalCell(row, header, profile.columns.category);
    const suggestedCategoryId = rawCategory
      ? (profile.categoryMap?.[rawCategory] ?? profile.categoryMap?.[fold(rawCategory)] ?? null)
      : null;

    transactions.push({
      accountId: context.accountId,
      bookingDate,
      valueDate: parseDate(optionalCell(row, header, profile.columns.valueDate), dateFormat),
      amount,
      side,
      description,
      counterparty: optionalCell(row, header, profile.columns.counterparty) || null,
      reference: optionalCell(row, header, profile.columns.reference) || null,
      suggestedCategoryId,
      source: 'file-import',
      externalId: null,
      importHash: importHashOf({
        accountId: context.accountId,
        bookingDate,
        amountMinor: amount.minor,
        description,
      }),
      notes: optionalCell(row, header, profile.columns.notes) || null,
    });
  });

  return { profileId: profile.id, transactions, issues };
}

/** Picks the first profile whose `detectHeaders` are all present. */
export function detectProfile(
  header: readonly string[],
  profiles: readonly ImportProfile[],
): ImportProfile | null {
  const folded = header.map(fold);
  for (const profile of profiles) {
    if (!profile.detectHeaders?.length) continue;
    const ok = profile.detectHeaders.every((h) => folded.some((f) => f.includes(fold(h))));
    if (ok) return profile;
  }
  return null;
}
