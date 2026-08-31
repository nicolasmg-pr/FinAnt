/**
 * Imports a Presupuesto workbook and reconciles the result against the totals
 * the spreadsheet computes for itself (`C2`, `F2`, `H2` on each month sheet).
 *
 *   npm run verify:workbook -- ~/Downloads/Presupuesto2025.xlsx [year]
 *
 * A mismatch means the importer disagrees with what the owner sees on screen,
 * which is the only definition of correct that matters here. The file is read
 * locally and nothing leaves the machine.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  importWorkbook,
  PRESUPUESTO_XLSX,
  readXlsx,
  yearFromFileName,
} from '@finant/importers';
import { UNCATEGORISED_ID, yearMonthOf } from '@finant/core';

const [path, yearArg] = process.argv.slice(2);
if (!path) {
  console.error('Usage: npm run verify:workbook -- <file.xlsx> [year]');
  process.exit(1);
}

const workbook = readXlsx(new Uint8Array(readFileSync(path)));
const year = yearArg ? Number(yearArg) : yearFromFileName(basename(path));

console.log(`file:   ${basename(path)}`);
console.log(`year:   ${year}`);
console.log(`sheets: ${workbook.sheetNames.join(', ')}\n`);

const result = importWorkbook(workbook, PRESUPUESTO_XLSX, { accountId: 'verify', year });

const euro = (minor: number) => (minor / 100).toFixed(2).padStart(11);
let mismatches = 0;

console.log('month      rows   imported income   sheet income   imported exp    sheet exp   net delta');
console.log('-'.repeat(92));

for (const [sheetName, monthNumber] of Object.entries(PRESUPUESTO_XLSX.monthSheets)) {
  const month = `${year}-${String(monthNumber).padStart(2, '0')}`;
  const rows = result.transactions.filter((t) => yearMonthOf(t.bookingDate) === month);

  // Summed by ledger side, signed, exactly as the sheet's own SUM does: a
  // negative row inside the expense block reduces the expense total.
  const imported = rows.reduce(
    (acc, t) => {
      if (t.side === 'income') acc.income += t.amount.minor;
      else acc.expense += -t.amount.minor;
      return acc;
    },
    { income: 0, expense: 0 },
  );

  const grid = workbook.sheet(sheetName);
  const sheetIncome = Math.round(Number(grid?.get('C2')?.value ?? '0') * 100);
  const sheetExpense = Math.round(Number(grid?.get('F2')?.value ?? '0') * 100);

  const incomeDelta = imported.income - sheetIncome;
  const expenseDelta = imported.expense - sheetExpense;
  const delta = incomeDelta || expenseDelta;
  if (Math.abs(incomeDelta) > 1 || Math.abs(expenseDelta) > 1) mismatches += 1;

  console.log(
    `${sheetName.padEnd(11)}${String(rows.length).padStart(4)}   ${euro(imported.income)}   ${euro(sheetIncome)}   ${euro(imported.expense)}  ${euro(sheetExpense)}  ${euro(delta)}${Math.abs(delta) > 1 ? '  <-- MISMATCH' : ''}`,
  );
}

const uncategorised = result.transactions.filter(
  (t) => t.suggestedCategoryId === null || t.suggestedCategoryId === UNCATEGORISED_ID,
);
const unmapped = new Map<string, number>();
for (const t of uncategorised) unmapped.set(t.description, (unmapped.get(t.description) ?? 0) + 1);

console.log('-'.repeat(92));
console.log(`\ntotal movements: ${result.transactions.length}`);
console.log(`issues:          ${result.issues.length}`);
console.log(`month mismatches: ${mismatches}`);
console.log(
  `categorised:     ${result.transactions.length - uncategorised.length}/${result.transactions.length} ` +
    `(${Math.round(((result.transactions.length - uncategorised.length) / result.transactions.length) * 100)}%)`,
);

if (unmapped.size > 0) {
  console.log(`\nconcepts with no category mapping (${unmapped.size}):`);
  for (const [concept, count] of [...unmapped.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${concept}`);
  }
}

if (result.issues.length > 0) {
  console.log('\nissues:');
  for (const issue of result.issues.slice(0, 20)) console.log(`  ${issue.message}`);
}

process.exit(mismatches > 0 ? 1 : 0);
