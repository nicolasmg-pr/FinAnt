import { describe, expect, it } from 'vitest';
import { detectDelimiter, readCsv } from '../src/csv';

describe('readCsv', () => {
  it('detects a semicolon delimiter, which most ES/DE banks use', () => {
    expect(detectDelimiter('a;b;c\n1;2;3\n')).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3\n')).toBe(',');
  });

  it('keeps a quoted delimiter inside a field', () => {
    const table = readCsv('date,description,amount\n2026-01-05,"REWE, Berlin",-42.10\n');
    expect(table.rows[0]).toEqual(['2026-01-05', 'REWE, Berlin', '-42.10']);
  });

  it('handles escaped quotes and embedded newlines', () => {
    const table = readCsv('a,b\n"say ""hi""","line1\nline2"\n');
    expect(table.rows[0]).toEqual(['say "hi"', 'line1\nline2']);
  });

  it('strips a UTF-8 BOM off the first header', () => {
    const table = readCsv('﻿Fecha;Concepto\n05/01/2026;CAFE\n');
    expect(table.header[0]).toBe('Fecha');
  });

  it('skips a preamble via headerRow', () => {
    const text = 'Mi presupuesto 2026\n\nFecha;Concepto;Importe\n05/01/2026;CAFE;-3,20\n';
    const table = readCsv(text, { headerRow: 1 });
    expect(table.header).toEqual(['Fecha', 'Concepto', 'Importe']);
    expect(table.rows).toHaveLength(1);
  });
});
