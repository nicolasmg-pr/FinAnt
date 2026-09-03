import { parseCMap, type CMap } from './cmap';
import { openPdf } from './document';
import { extractTextItems, type PdfTextItem } from './text';

export type { CMap } from './cmap';
export type { PdfDocument } from './document';
export type { PdfTextItem } from './text';
export { openPdf } from './document';
export { parseCMap } from './cmap';
export { extractTextItems } from './text';

export interface PdfPage {
  /** 1-based, as the reader would count them. */
  readonly number: number;
  readonly items: readonly PdfTextItem[];
}

/**
 * Every page's positioned text.
 *
 * A font with no `ToUnicode` table is left out of the map handed to the text
 * layer, so its glyphs are skipped rather than guessed: the codes in a subset
 * font mean nothing without the table, and emitting them raw would put
 * convincing nonsense into a movement's narrative.
 */
export function extractPdfPages(bytes: Uint8Array): PdfPage[] {
  const doc = openPdf(bytes);
  const cmaps = new Map<string, CMap>();

  return doc.pages.map((page, index) => {
    const fonts = new Map<string, CMap>();
    for (const [name, font] of doc.fontsOf(page)) {
      const toUnicode = font.get('ToUnicode');
      if (toUnicode === undefined) continue;
      // One CMap object is shared by every page of a statement; parsing it once
      // per page would parse the same table fifty-three times.
      const key = JSON.stringify(toUnicode);
      const cached = cmaps.get(key);
      const cmap = cached ?? parseCMap(doc.streamOf(toUnicode));
      if (!cached) cmaps.set(key, cmap);
      fonts.set(name, cmap);
    }
    return { number: index + 1, items: extractTextItems(doc.contentOf(page), fonts) };
  });
}
