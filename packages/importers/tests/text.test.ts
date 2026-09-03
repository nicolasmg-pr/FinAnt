import { describe, expect, it } from 'vitest';
import { decodeStatement } from '../src/text';

/** Encodes a string one byte per code point, which is exactly ISO-8859-1. */
function latin1(text: string): Uint8Array {
  return Uint8Array.from([...text].map((ch) => ch.charCodeAt(0)));
}

describe('decodeStatement', () => {
  it('reads a UTF-8 statement unchanged', () => {
    const bytes = new TextEncoder().encode('Buchung;Währung\n02.03.2026;EUR\n');
    expect(decodeStatement(bytes)).toBe('Buchung;Währung\n02.03.2026;EUR\n');
  });

  it('falls back to ISO-8859-1 when the bytes are not valid UTF-8', () => {
    // ING writes ISO-8859-1. Decoded as UTF-8 the umlauts become U+FFFD and
    // land in the stored narrative, so the encoding has to be sniffed.
    expect(decodeStatement(latin1('Umsätze;Empfänger'))).toBe('Umsätze;Empfänger');
  });

  it('maps the windows-1252 range that ISO-8859-1 leaves undefined', () => {
    expect(decodeStatement(Uint8Array.from([0x80, 0x35, 0x30]))).toBe('€50');
  });

  it('keeps a UTF-8 statement that happens to contain only ASCII', () => {
    expect(decodeStatement(new TextEncoder().encode('a;b\n1;2\n'))).toBe('a;b\n1;2\n');
  });
});
