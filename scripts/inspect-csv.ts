/**
 * Prints the shape of an unknown CSV and a ready-to-paste ImportProfile
 * skeleton. Point it at a Google Sheets or bank export before writing a
 * profile by hand.
 *
 *   npm run inspect:csv -- ~/Downloads/my-tracker.csv [headerRow]
 *
 * The file is read locally and nothing leaves the machine.
 */
import { readFileSync } from 'node:fs';
import { inspectCsv } from '@finant/importers';

const [path, headerRowArg] = process.argv.slice(2);
if (!path) {
  console.error('Usage: npm run inspect:csv -- <file.csv> [headerRow]');
  process.exit(1);
}

const text = readFileSync(path, 'utf8');
const report = inspectCsv(text, Number(headerRowArg ?? 0));

console.log(`delimiter: ${JSON.stringify(report.delimiter)}`);
console.log(`data rows: ${report.rowCount}\n`);
for (const column of report.columns) {
  const samples = column.samples.map((s) => JSON.stringify(s)).join(', ');
  console.log(`[${column.index}] ${column.header.padEnd(28)} ${column.guess.padEnd(9)} ${samples}`);
}

const dateColumn = report.columns.find((c) => c.guess === 'date');
const amountColumns = report.columns.filter((c) => c.guess === 'amount');
const categoryColumn = report.columns.find((c) => c.guess === 'category');
const textColumn = report.columns.find((c) => c.guess === 'text');

console.log('\n--- profile skeleton ---');
console.log(
  JSON.stringify(
    {
      id: 'google-sheets-tracker',
      label: 'My Google Sheets tracker',
      headerRow: Number(headerRowArg ?? 0),
      dateFormat: 'auto',
      decimalSeparator: 'auto',
      defaultCurrency: 'EUR',
      columns: {
        bookingDate: { header: dateColumn?.header ?? 'TODO' },
        description: { header: textColumn?.header ?? 'TODO' },
        ...(amountColumns.length === 1
          ? { amount: { header: amountColumns[0]?.header } }
          : {
              debit: { header: amountColumns[0]?.header ?? 'TODO' },
              credit: { header: amountColumns[1]?.header ?? 'TODO' },
            }),
        ...(categoryColumn ? { category: { header: categoryColumn.header } } : {}),
      },
      signConvention: 'signed',
    },
    null,
    2,
  ),
);
console.log(
  '\nCheck signConvention against a known expense row, then paste into ' +
    'packages/importers/src/profiles/google-sheets.ts',
);
