/**
 * Statement text decoding.
 *
 * German bank exports are still written in ISO-8859-1: ING's Umsatzanzeige is,
 * and decoding one as UTF-8 turns every umlaut into U+FFFD, which then lands in
 * the stored narrative and in the categorisation rules that match on it. The
 * encoding is not declared anywhere in the file, so it is sniffed: valid UTF-8
 * is overwhelmingly unlikely to be an accident, and anything else is read as
 * windows-1252 (ISO-8859-1 plus the printable characters ISO-8859-1 leaves
 * undefined between 0x80 and 0x9F).
 *
 * Both decoders are written out rather than delegated to `TextDecoder`, which
 * Hermes does not offer for legacy labels.
 */

/** windows-1252 replacements for 0x80-0x9F; an empty slot keeps the raw byte. */
const CP1252_HIGH: readonly string[] = [
  '€',
  '',
  '‚',
  'ƒ',
  '„',
  '…',
  '†',
  '‡',
  'ˆ',
  '‰',
  'Š',
  '‹',
  'Œ',
  '',
  'Ž',
  '',
  '',
  '‘',
  '’',
  '“',
  '”',
  '•',
  '–',
  '—',
  '˜',
  '™',
  'š',
  '›',
  'œ',
  '',
  'ž',
  'Ÿ',
];

export function isValidUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const lead = bytes[i]!;
    if (lead < 0x80) {
      i += 1;
      continue;
    }
    let extra: number;
    let codePoint: number;
    let smallest: number;
    if (lead >= 0xc2 && lead <= 0xdf) {
      extra = 1;
      codePoint = lead & 0x1f;
      smallest = 0x80;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      extra = 2;
      codePoint = lead & 0x0f;
      smallest = 0x800;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      extra = 3;
      codePoint = lead & 0x07;
      smallest = 0x10000;
    } else {
      // A bare continuation byte, or the overlong lead bytes 0xC0/0xC1.
      return false;
    }
    if (i + extra >= bytes.length) return false;
    for (let k = 1; k <= extra; k += 1) {
      const next = bytes[i + k]!;
      if ((next & 0xc0) !== 0x80) return false;
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    // Overlong encodings, surrogates and out-of-range values are all invalid,
    // and a latin-1 file reaches one of them within a few accented characters.
    if (codePoint < smallest || codePoint > 0x10ffff) return false;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false;
    i += extra + 1;
  }
  return true;
}

function decodeUtf8(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    const lead = bytes[i]!;
    if (lead < 0x80) {
      out.push(String.fromCharCode(lead));
      i += 1;
      continue;
    }
    const extra = lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : 1;
    let codePoint = lead & (extra === 1 ? 0x1f : extra === 2 ? 0x0f : 0x07);
    for (let k = 1; k <= extra; k += 1) codePoint = (codePoint << 6) | (bytes[i + k]! & 0x3f);
    out.push(String.fromCodePoint(codePoint));
    i += extra + 1;
  }
  return out.join('');
}

function decodeCp1252(bytes: Uint8Array): string {
  const out: string[] = [];
  for (const byte of bytes) {
    const replacement = byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80]! : '';
    out.push(replacement === '' ? String.fromCharCode(byte) : replacement);
  }
  return out.join('');
}

/** Decodes statement bytes, preferring UTF-8 and falling back to windows-1252. */
export function decodeStatement(bytes: Uint8Array): string {
  return isValidUtf8(bytes) ? decodeUtf8(bytes) : decodeCp1252(bytes);
}
