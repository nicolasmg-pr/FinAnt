import { describe, expect, it } from 'vitest';
import { parseCMap } from '../src/pdf/cmap';
import { extractTextItems } from '../src/pdf/text';
import { pdfBytes } from './pdf-fixture';

const cmap = (source: string) => parseCMap(pdfBytes(source));

describe('parseCMap', () => {
  it('maps single codes from bfchar', () => {
    const map = cmap(`
      1 begincodespacerange <0000> <FFFF> endcodespacerange
      2 beginbfchar <0003> <0041> <0004> <0042> endbfchar
    `);
    expect(map.lookup(0x0003)).toBe('A');
    expect(map.lookup(0x0004)).toBe('B');
  });

  it('maps a run from bfrange', () => {
    const map = cmap('1 beginbfrange <0010> <0012> <0061> endbfrange');
    expect(map.lookup(0x0010)).toBe('a');
    expect(map.lookup(0x0011)).toBe('b');
    expect(map.lookup(0x0012)).toBe('c');
  });

  it('maps an explicit array in bfrange', () => {
    const map = cmap('1 beginbfrange <0020> <0021> [<0058> <0059>] endbfrange');
    expect(map.lookup(0x0020)).toBe('X');
    expect(map.lookup(0x0021)).toBe('Y');
  });

  it('decodes a surrogate pair written as four bytes', () => {
    const map = cmap('1 beginbfchar <0005> <D83DDE00> endbfchar');
    expect(map.lookup(0x0005)).toBe('\u{1F600}');
  });

  it('reads the code width from the codespace range', () => {
    expect(cmap('1 begincodespacerange <00> <FF> endcodespacerange').codeBytes).toBe(1);
    expect(cmap('1 begincodespacerange <0000> <FFFF> endcodespacerange').codeBytes).toBe(2);
  });

  it('assumes two-byte codes when no codespace range is given', () => {
    expect(cmap('1 beginbfchar <0003> <0041> endbfchar').codeBytes).toBe(2);
  });

  it('returns nothing for a code it does not carry', () => {
    expect(cmap('1 beginbfchar <0003> <0041> endbfchar').lookup(0x0099)).toBe(null);
  });
});

describe('extractTextItems', () => {
  const identity = cmap(`
    1 begincodespacerange <0000> <FFFF> endcodespacerange
    3 beginbfchar <0001> <0048> <0002> <0069> <0003> <0021> endbfchar
  `);
  const fonts = new Map([['F1', identity]]);

  const items = (content: string) => extractTextItems(pdfBytes(content), fonts);

  it('places a string at the text matrix translation', () => {
    const out = items('BT /F1 12 Tf 1 0 0 1 100 700 Tm <000100020003> Tj ET');
    expect(out).toEqual([{ text: 'Hi!', x: 100, y: 700, fontSize: 12 }]);
  });

  it('applies Td as a move relative to the line start', () => {
    const out = items('BT /F1 10 Tf 1 0 0 1 50 500 Tm 10 -20 Td <0001> Tj ET');
    expect(out[0]).toMatchObject({ x: 60, y: 480 });
  });

  it('applies the leading set by TD and repeated by T*', () => {
    const out = items('BT /F1 10 Tf 1 0 0 1 0 100 Tm 0 -12 TD <0001> Tj T* <0002> Tj ET');
    expect(out.map((i) => i.y)).toEqual([88, 76]);
  });

  it('reads a TJ array, ignoring its kerning numbers', () => {
    const out = items('BT /F1 10 Tf 1 0 0 1 0 0 Tm [<0001> -200 <0002>] TJ ET');
    expect(out[0]?.text).toBe('Hi');
  });

  it('combines the text matrix with the current transformation matrix', () => {
    const out = items('q 1 0 0 1 20 30 cm BT /F1 10 Tf 1 0 0 1 5 5 Tm <0001> Tj ET Q');
    expect(out[0]).toMatchObject({ x: 25, y: 35 });
  });

  it('restores the transformation matrix at Q', () => {
    const out = items('q 1 0 0 1 20 30 cm Q BT /F1 10 Tf 1 0 0 1 5 5 Tm <0001> Tj ET');
    expect(out[0]).toMatchObject({ x: 5, y: 5 });
  });

  it('skips a code the font cannot map rather than emitting a replacement', () => {
    const out = items('BT /F1 10 Tf 1 0 0 1 0 0 Tm <00010099> Tj ET');
    expect(out[0]?.text).toBe('H');
  });

  it('emits nothing for a string outside BT/ET or with no font set', () => {
    expect(items('<0001> Tj')).toEqual([]);
    expect(items('BT 1 0 0 1 0 0 Tm <0001> Tj ET')).toEqual([]);
  });

  it('ignores a text-showing operator whose font resource is unknown', () => {
    expect(items('BT /F9 10 Tf 1 0 0 1 0 0 Tm <0001> Tj ET')).toEqual([]);
  });

  it('drops an empty string rather than emitting a positioned blank', () => {
    expect(items('BT /F1 10 Tf 1 0 0 1 0 0 Tm <> Tj ET')).toEqual([]);
  });
});
