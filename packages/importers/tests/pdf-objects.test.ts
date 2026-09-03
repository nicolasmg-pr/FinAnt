import { describe, expect, it } from 'vitest';
import {
  asDict,
  asName,
  asNumber,
  latin1,
  parseObject,
  parseObjects,
  type PdfDict,
} from '../src/pdf/objects';

const bytes = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
const parse = (text: string) => parseObject(bytes(text), 0).value;
const entry = (dict: PdfDict, key: string) => dict.get(key);

describe('numbers and keywords', () => {
  it('reads integers, reals and signs', () => {
    expect(parse('42')).toBe(42);
    expect(parse('-3.5')).toBe(-3.5);
    expect(parse('+7')).toBe(7);
    expect(parse('.5')).toBe(0.5);
  });

  it('reads the three keywords', () => {
    expect(parse('true')).toBe(true);
    expect(parse('false')).toBe(false);
    expect(parse('null')).toBe(null);
  });
});

describe('names', () => {
  it('reads a plain name', () => {
    expect(asName(parse('/Type'))).toBe('Type');
  });

  it('decodes #xx escapes, which appear in font names', () => {
    expect(asName(parse('/A#20B'))).toBe('A B');
  });

  it('ends a name at a delimiter', () => {
    expect(asName(parse('/Name/Other'))).toBe('Name');
  });
});

describe('strings', () => {
  it('reads a literal string', () => {
    expect(latin1(parse('(hello)'))).toBe('hello');
  });

  it('keeps balanced parentheses inside a literal string', () => {
    expect(latin1(parse('(a (b) c)'))).toBe('a (b) c');
  });

  it('applies backslash escapes, including octal', () => {
    expect(latin1(parse('(a\\)b)'))).toBe('a)b');
    expect(latin1(parse('(\\101)'))).toBe('A');
    expect(latin1(parse('(a\\nb)'))).toBe('a\nb');
  });

  it('reads a hex string, padding an odd final digit with zero', () => {
    expect(latin1(parse('<414243>'))).toBe('ABC');
    expect(latin1(parse('<4>'))).toBe('@');
  });

  it('ignores whitespace inside a hex string', () => {
    expect(latin1(parse('<41 42\n43>'))).toBe('ABC');
  });
});

describe('arrays and dictionaries', () => {
  it('reads a nested array', () => {
    expect(parse('[1 2 [3 4]]')).toEqual([1, 2, [3, 4]]);
  });

  it('reads a dictionary', () => {
    const dict = asDict(parse('<< /Type /Page /Count 3 >>'));
    expect(asName(entry(dict, 'Type'))).toBe('Page');
    expect(asNumber(entry(dict, 'Count'))).toBe(3);
  });

  it('reads a nested dictionary', () => {
    const dict = asDict(parse('<< /Font << /F1 12 >> >>'));
    expect(asNumber(entry(asDict(entry(dict, 'Font')), 'F1'))).toBe(12);
  });

  it('reads an indirect reference rather than two numbers', () => {
    // A reference is three tokens, so it is only recognisable across a
    // sequence: `parseObject` reads one object and would stop at the 12.
    expect(parseObjects(bytes('12 0 R'), 0, 4)).toEqual([{ num: 12, gen: 0 }]);
    expect(parse('[1 0 R 2 0 R]')).toEqual([
      { num: 1, gen: 0 },
      { num: 2, gen: 0 },
    ]);
  });

  it('does not mistake two plain numbers for a reference', () => {
    expect(parse('[1 2]')).toEqual([1, 2]);
  });

  it('skips comments and irregular whitespace', () => {
    const dict = asDict(parse('<<\n% a comment\r\n/A 1\t>>'));
    expect(asNumber(entry(dict, 'A'))).toBe(1);
  });
});
