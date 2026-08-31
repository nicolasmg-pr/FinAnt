import { strToU8, zipSync } from 'fflate';

/**
 * Builds a minimal .xlsx in memory.
 *
 * Fixtures are generated rather than committed: a real budget export is
 * personal financial data and must never enter the repository, and a generated
 * workbook makes the layout under test readable in the test itself.
 */
export interface SheetSpec {
  readonly name: string;
  /** Cell reference -> value. Numbers are written as numeric cells. */
  readonly cells: Readonly<Record<string, string | number>>;
}

export function buildXlsx(sheets: readonly SheetSpec[]): Uint8Array {
  const strings: string[] = [];
  const stringIndex = (value: string): number => {
    const existing = strings.indexOf(value);
    if (existing >= 0) return existing;
    strings.push(value);
    return strings.length - 1;
  };

  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const files: Record<string, Uint8Array> = {};

  sheets.forEach((sheet, i) => {
    const byRow = new Map<number, string[]>();
    for (const [ref, raw] of Object.entries(sheet.cells)) {
      const match = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!match) throw new Error(`Bad cell reference: ${ref}`);
      const row = Number(match[2]);
      const cell =
        typeof raw === 'number'
          ? `<c r="${ref}"><v>${raw}</v></c>`
          : `<c r="${ref}" t="s"><v>${stringIndex(raw)}</v></c>`;
      const list = byRow.get(row) ?? [];
      list.push(cell);
      byRow.set(row, list);
    }

    const rows = [...byRow.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([row, cells]) => `<row r="${row}">${cells.join('')}</row>`)
      .join('');

    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
    );
  });

  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${escape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
  );

  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}</Relationships>`,
  );

  files['xl/sharedStrings.xml'] = strToU8(
    `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
      .map((s) => `<si><t>${escape(s)}</t></si>`)
      .join('')}</sst>`,
  );

  return zipSync(files);
}

/** A month sheet in the tracker's layout: income in A/B, expenses in D/E. */
export function monthSheet(
  name: string,
  income: readonly [string, number][],
  expenses: readonly [string, number][],
): SheetSpec {
  const cells: Record<string, string | number> = {
    A1: 'Conceptos',
    B1: 'Ingresos',
    C1: 'Total',
    D1: 'Conceptos',
    E1: 'Gastos',
    F1: 'Total',
    H1: 'Resultado',
    // The real workbook holds SUM formulas here; only their cached values are
    // stored, and they sit outside the scanned columns either way.
    C2: income.reduce((a, [, v]) => a + v, 0),
    F2: expenses.reduce((a, [, v]) => a + v, 0),
  };
  income.forEach(([concept, value], i) => {
    cells[`A${i + 2}`] = concept;
    cells[`B${i + 2}`] = value;
  });
  expenses.forEach(([concept, value], i) => {
    cells[`D${i + 2}`] = concept;
    cells[`E${i + 2}`] = value;
  });
  return { name, cells };
}
