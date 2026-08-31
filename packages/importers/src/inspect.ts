import { readCsv } from './csv';

export interface ColumnInsight {
  readonly index: number;
  readonly header: string;
  readonly samples: readonly string[];
  readonly guess: 'date' | 'amount' | 'category' | 'text' | 'empty';
}

/**
 * Describes an unknown CSV so a profile can be written from evidence rather
 * than from assumptions about how someone lays out their spreadsheet.
 */
export function inspectCsv(text: string, headerRow = 0): {
  delimiter: string;
  header: readonly string[];
  rowCount: number;
  columns: readonly ColumnInsight[];
} {
  const table = readCsv(text, { headerRow });
  const sampleRows = table.rows.slice(0, 40);

  const columns = table.header.map((header, index) => {
    const values = sampleRows.map((r) => (r[index] ?? '').trim()).filter((v) => v !== '');
    const isDate = values.length > 0 && values.every((v) => /^\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}|^\d{5}$/.test(v));
    const isAmount = values.length > 0 && values.every((v) => /^[-+(]?\s*[\d.,]+\s*[)€$]?$/.test(v));
    const distinct = new Set(values.map((v) => v.toLowerCase()));
    const looksCategorical = values.length >= 5 && distinct.size <= Math.max(3, values.length / 3);

    return {
      index,
      header,
      samples: values.slice(0, 5),
      guess: values.length === 0
        ? ('empty' as const)
        : isDate
          ? ('date' as const)
          : isAmount
            ? ('amount' as const)
            : looksCategorical
              ? ('category' as const)
              : ('text' as const),
    };
  });

  return { delimiter: table.delimiter, header: table.header, rowCount: table.rows.length, columns };
}
