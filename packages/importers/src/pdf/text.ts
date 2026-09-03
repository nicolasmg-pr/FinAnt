import type { CMap } from './cmap';
import { isString, parseObject, skipSpace, type PdfValue } from './objects';

/**
 * The text-showing subset of the content stream language.
 *
 * A content stream is postfix: operands accumulate until an operator consumes
 * them. Only the operators that place or show text are honoured; everything
 * else — paths, images, colour, clipping — is skipped by discarding operands,
 * which is safe because none of them can change where text lands except through
 * `cm`, which is tracked.
 */

export interface PdfTextItem {
  readonly text: string;
  /** Device-space position of the text, from the text and transformation matrices. */
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
}

/** `[a b c d e f]`, the PDF matrix form. */
type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function matrixFrom(operands: readonly PdfValue[]): Matrix | null {
  const numbers = operands.slice(-6).map((value) => (typeof value === 'number' ? value : null));
  if (numbers.length < 6 || numbers.some((n) => n === null)) return null;
  return numbers as unknown as Matrix;
}

function numberAt(operands: readonly PdfValue[], fromEnd: number): number {
  const value = operands[operands.length - fromEnd];
  return typeof value === 'number' ? value : 0;
}

/** Decodes a shown string through the font's CMap, dropping codes it lacks. */
function decode(value: PdfValue, font: CMap): string {
  if (!isString(value)) return '';
  const { bytes } = value;
  const width = font.codeBytes;
  let out = '';
  for (let i = 0; i + width <= bytes.length; i += width) {
    let code = 0;
    for (let b = 0; b < width; b += 1) code = code * 256 + bytes[i + b]!;
    out += font.lookup(code) ?? '';
  }
  return out;
}

/**
 * Reads the positioned text out of one page's content stream.
 *
 * `fonts` maps the page's font resource names to their `ToUnicode` CMaps. A
 * resource with no CMap is skipped rather than guessed at: emitting the raw
 * glyph ids would put convincing nonsense into a movement's narrative.
 */
export function extractTextItems(
  content: Uint8Array,
  fonts: ReadonlyMap<string, CMap>,
): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  let textMatrix: Matrix = IDENTITY;
  let lineMatrix: Matrix = IDENTITY;
  let leading = 0;
  let fontSize = 0;
  let font: CMap | null = null;
  let inText = false;
  let operands: PdfValue[] = [];

  const show = (value: PdfValue): void => {
    if (!inText || !font) return;
    const text = decode(value, font);
    if (text === '') return;
    const placed = multiply(textMatrix, ctm);
    items.push({ text, x: placed[4], y: placed[5], fontSize });
  };

  const newline = (tx: number, ty: number): void => {
    lineMatrix = multiply([1, 0, 0, 1, tx, ty], lineMatrix);
    textMatrix = lineMatrix;
  };

  let i = 0;
  while (i < content.length) {
    const start = skipSpace(content, i);
    if (start >= content.length) break;
    const parsed = parseObject(content, start);
    if (parsed.end === start) {
      i = start + 1;
      continue;
    }
    i = parsed.end;
    const value = parsed.value;

    // The object parser returns a `/Name` operand and a bare operator keyword
    // in the same shape, because PDF has no other way to write a keyword. The
    // slash in the source is what tells them apart.
    const keyword =
      typeof value === 'object' && value !== null && 'name' in value && content[start] !== 0x2f
        ? value.name
        : null;

    if (keyword === null) {
      operands.push(value);
      // A malformed stream must not grow this without bound; no operator takes
      // more than six operands.
      if (operands.length > 64) operands = operands.slice(-8);
      continue;
    }
    const operator = keyword;

    switch (operator) {
      case 'q':
        stack.push(ctm);
        break;
      case 'Q':
        ctm = stack.pop() ?? IDENTITY;
        break;
      case 'cm': {
        const m = matrixFrom(operands);
        if (m) ctm = multiply(m, ctm);
        break;
      }
      case 'BT':
        inText = true;
        textMatrix = IDENTITY;
        lineMatrix = IDENTITY;
        break;
      case 'ET':
        inText = false;
        break;
      case 'Tf': {
        fontSize = numberAt(operands, 1);
        const name = operands[operands.length - 2];
        const resource =
          typeof name === 'object' && name !== null && 'name' in name ? name.name : '';
        font = fonts.get(resource) ?? null;
        break;
      }
      case 'Tm': {
        const m = matrixFrom(operands);
        if (m) {
          textMatrix = m;
          lineMatrix = m;
        }
        break;
      }
      case 'Td':
        newline(numberAt(operands, 2), numberAt(operands, 1));
        break;
      case 'TD':
        leading = -numberAt(operands, 1);
        newline(numberAt(operands, 2), numberAt(operands, 1));
        break;
      case 'TL':
        leading = numberAt(operands, 1);
        break;
      case 'T*':
        newline(0, -leading);
        break;
      case 'Tj':
        show(operands[operands.length - 1] ?? null);
        break;
      case "'":
        newline(0, -leading);
        show(operands[operands.length - 1] ?? null);
        break;
      case '"':
        newline(0, -leading);
        show(operands[operands.length - 1] ?? null);
        break;
      case 'TJ': {
        const array = operands[operands.length - 1];
        if (Array.isArray(array)) {
          // The numbers between strings are kerning adjustments. They shift the
          // next glyph, not the run's origin, so for column detection they can
          // be ignored and the pieces joined.
          const text = array.map((part) => (font ? decode(part, font) : '')).join('');
          if (text !== '' && inText && font) {
            const placed = multiply(textMatrix, ctm);
            items.push({ text, x: placed[4], y: placed[5], fontSize });
          }
        }
        break;
      }
      default:
        break;
    }
    operands = [];
  }

  return items;
}
