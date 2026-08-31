import { importHashOf, money } from '@finant/core';
import type { DraftTransaction, ImportIssue, ImportResult } from './profile';
import { parseAmount } from './values';
import type { SheetGrid, Workbook } from './xlsx';

/** One vertical block of concept/amount pairs inside a month sheet. */
export interface BlockSpec {
  readonly conceptColumn: string;
  readonly amountColumn: string;
  readonly direction: 'income' | 'expense';
}

export interface WorkbookProfile {
  readonly id: string;
  readonly label: string;
  /** Sheet name -> calendar month number. Sheets not listed here are ignored. */
  readonly monthSheets: Readonly<Record<string, number>>;
  readonly firstDataRow: number;
  /** Upper bound on the scan. Cheap insurance against a stray cell far down. */
  readonly lastDataRow: number;
  readonly blocks: readonly BlockSpec[];
  readonly defaultCurrency: string;
  /**
   * Day assigned to every movement, because the sheet records a month but no
   * day. Never invented per row: one fixed, documented day keeps monthly
   * figures exact and makes the imprecision visible instead of plausible.
   */
  readonly dayOfMonth: number;
  /**
   * Concept label -> FinAnt category id, kept separately per direction. The
   * same word means different things in the two blocks: "kaution" is a deposit
   * paid on the expense side and the same deposit returned on the income side,
   * and "intereses" is a bank charge one way and interest earned the other.
   */
  readonly categoryMap: Readonly<Record<'income' | 'expense', Readonly<Record<string, string>>>>;
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function cell(grid: SheetGrid, column: string, row: number): string {
  return (grid.get(`${column}${row}`)?.value ?? '').trim();
}

export interface WorkbookImportContext {
  readonly accountId: string;
  /** Calendar year the workbook covers. Sheet names carry the month only. */
  readonly year: number;
  readonly currency?: string;
}

/**
 * Reads a month-per-sheet budget workbook into draft transactions.
 *
 * The layout it expects is a hand-kept tracker: one sheet per month, each with
 * an income block and an expense block side by side, concepts as free text and
 * amounts written as positive magnitudes. Signs are applied from the block the
 * row sits in, exactly as the spreadsheet presents them — a negative value
 * inside the expense block is a refund and keeps its meaning after negation.
 */
export function importWorkbook(
  workbook: Workbook,
  profile: WorkbookProfile,
  context: WorkbookImportContext,
): ImportResult {
  const currency = context.currency ?? profile.defaultCurrency;
  const transactions: DraftTransaction[] = [];
  const issues: ImportIssue[] = [];

  let sheetsFound = 0;

  for (const [sheetName, monthNumber] of Object.entries(profile.monthSheets)) {
    const grid = workbook.sheet(sheetName);
    // A month sheet that does not exist yet is normal in a year still being
    // filled in, so it is skipped in silence. Only a workbook with no month
    // sheet at all is worth reporting.
    if (!grid) continue;
    sheetsFound += 1;

    const bookingDate = `${String(context.year).padStart(4, '0')}-${String(monthNumber).padStart(2, '0')}-${String(profile.dayOfMonth).padStart(2, '0')}`;

    // Counts identical rows within the sheet so a concept the owner legitimately
    // repeats at the same amount does not collapse into one deduped movement.
    const occurrences = new Map<string, number>();

    for (const block of profile.blocks) {
      for (let row = profile.firstDataRow; row <= profile.lastDataRow; row += 1) {
        const concept = cell(grid, block.conceptColumn, row);
        const rawAmount = cell(grid, block.amountColumn, row);
        if (concept === '' && rawAmount === '') continue;

        const sourceRef = `${sheetName}!${block.amountColumn}${row}`;

        if (concept === '' || rawAmount === '') {
          issues.push({
            row,
            message: `${sourceRef}: ${concept === '' ? 'amount without a concept' : 'concept without an amount'}`,
            raw: [concept, rawAmount],
          });
          continue;
        }

        // Spreadsheet cells are stored unformatted, so '.' is always the decimal point.
        const magnitude = parseAmount(rawAmount, currency, '.');
        if (!magnitude) {
          issues.push({ row, message: `${sourceRef}: unreadable amount "${rawAmount}"`, raw: [concept, rawAmount] });
          continue;
        }
        if (magnitude.minor === 0) continue;

        const signed = money(
          block.direction === 'expense' ? -magnitude.minor : magnitude.minor,
          currency,
        );

        const key = `${block.direction}|${fold(concept)}|${signed.minor}`;
        const seen = occurrences.get(key) ?? 0;
        occurrences.set(key, seen + 1);

        transactions.push({
          accountId: context.accountId,
          bookingDate,
          valueDate: null,
          amount: signed,
          // The block the row sits in is the ledger's own statement of side, so
          // a negative expense row reduces spending rather than becoming income.
          side: block.direction,
          description: concept,
          counterparty: concept,
          reference: null,
          suggestedCategoryId: profile.categoryMap[block.direction][fold(concept)] ?? null,
          source: 'file-import',
          externalId: null,
          importHash: importHashOf({
            accountId: context.accountId,
            bookingDate,
            amountMinor: signed.minor,
            description: concept,
            discriminator: seen,
          }),
          notes: sourceRef,
        });
      }
    }
  }

  if (sheetsFound === 0) {
    issues.push({
      row: 0,
      message: `No month sheets found. Expected sheets named ${Object.keys(profile.monthSheets).slice(0, 3).join(', ')}…`,
      raw: [],
    });
  }

  return { profileId: profile.id, transactions, issues };
}

/** Reads the year from a filename such as `Presupuesto2025.xlsx`. */
export function yearFromFileName(fileName: string, fallback = new Date().getUTCFullYear()): number {
  const match = /(20\d{2})/.exec(fileName);
  return match ? Number(match[1]) : fallback;
}
