import type { CsvTable } from '../csv';
import type { PdfPage, PdfTextItem } from './index';

/**
 * Recovers a table from positioned PDF text.
 *
 * A PDF has no notion of a table: it has glyphs at coordinates, and the grid
 * exists only because a renderer put them where a grid would be. So the header
 * row is found by its labels, the columns are learned from where those labels
 * sit, and every other item is assigned to the column whose header it is
 * nearest to.
 *
 * The result is a `CsvTable`, which means `applyProfile` maps it exactly as it
 * maps a bank's CSV — including the debit/credit column pair, where the side of
 * the ledger comes from which column an amount is in rather than from a sign.
 */

export interface PdfTableSpec {
  /** Labels that identify the header row. All must be present on a page. */
  readonly headers: readonly string[];
  /**
   * The header whose column holds exactly one cell per row. Rows are anchored
   * on it, because a running balance is the one column a statement never leaves
   * blank — an amount column is empty on half the rows by construction.
   */
  readonly anchor: string;
  /** How far above its anchor a cell may sit and still belong to that row. */
  readonly rowGap?: number;
  /**
   * What an anchor cell has to look like. Page furniture — a footer, a
   * generated-on timestamp — can sit nearest the anchor column and would
   * otherwise start a row of its own. Defaults to "contains a digit".
   */
  readonly anchorPattern?: RegExp;
  /**
   * Headers whose cell a real row always fills. A page can carry a second,
   * unrelated table whose columns happen to fall near these ones; requiring the
   * columns that identify *this* table is what keeps its rows out.
   */
  readonly requiredColumns?: readonly string[];
}

/** Typical vertical distance between rows, for bounding the last one. */
function medianPitch(ys: readonly number[], gap: number): number {
  const gaps: number[] = [];
  for (let i = 0; i + 1 < ys.length; i += 1) gaps.push(ys[i]! - ys[i + 1]!);
  if (gaps.length === 0) return gap * 4;
  const sorted = [...gaps].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? gap * 4;
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

interface Column {
  readonly label: string;
  readonly x: number;
}

interface Header {
  readonly columns: readonly Column[];
  /** The y the header band sits at. Everything at or above it is not a row. */
  readonly y: number;
}

/**
 * Finds the header band on a page: the y at which every wanted label appears.
 *
 * Matching all of them is what keeps a second, unrelated table out of the
 * result. The owner's statement carries one on its later pages with its own
 * column grid, and reading it as movements would invent rows.
 */
function findHeader(page: PdfPage, spec: PdfTableSpec): Header | null {
  const wanted = spec.headers.map(fold);
  const bands = new Map<number, PdfTextItem[]>();
  for (const item of page.items) {
    if (item.text.trim() === '') continue;
    const y = Math.round(item.y);
    const key = [...bands.keys()].find((existing) => Math.abs(existing - y) <= 2) ?? y;
    bands.set(key, [...(bands.get(key) ?? []), item]);
  }

  for (const [bandY, items] of [...bands.entries()].sort((a, b) => b[0] - a[0])) {
    const columns: Column[] = [];
    for (const label of wanted) {
      const hit = items.find((item) => fold(item.text) === label);
      if (!hit) break;
      columns.push({ label, x: hit.x });
    }
    if (columns.length === spec.headers.length) {
      return {
        columns: columns.map((column, index) => ({ label: spec.headers[index]!, x: column.x })),
        y: bandY,
      };
    }
  }
  return null;
}

/** The column an item belongs to: the one whose header it sits nearest to. */
function columnOf(item: PdfTextItem, columns: readonly Column[]): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  columns.forEach((column, index) => {
    const distance = Math.abs(item.x - column.x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

export function pdfTable(pages: readonly PdfPage[], spec: PdfTableSpec): CsvTable {
  const gap = spec.rowGap ?? 8;
  const rows: string[][] = [];
  const rowLines: number[] = [];

  for (const page of pages) {
    const header = findHeader(page, spec);
    if (!header) continue;
    const { columns } = header;
    const anchorIndex = spec.headers.findIndex((label) => fold(label) === fold(spec.anchor));
    if (anchorIndex < 0) continue;

    // Everything below the header band. The page title sits above it, and
    // merging that into the first row's date cell is exactly what happens if
    // this bound is taken from anywhere but the band that was just found.
    const body = page.items.filter((item) => item.text.trim() !== '' && item.y < header.y - 2);
    const placed = body.map((item) => ({ item, column: columnOf(item, columns) }));

    const looksLikeAnchor = spec.anchorPattern ?? /\d/;
    const anchors = placed
      .filter((entry) => entry.column === anchorIndex && looksLikeAnchor.test(entry.item.text))
      .sort((a, b) => b.item.y - a.item.y);

    // How far apart rows sit on this page, so the last one on it can be given
    // a lower bound too. Without one it runs to the bottom of the page and
    // swallows the footer — one wrong row per page, every page.
    const pitch = medianPitch(
      anchors.map((anchor) => anchor.item.y),
      gap,
    );

    anchors.forEach((anchor, index) => {
      const top = anchor.item.y + gap;
      // A row owns everything down to just above the next row's anchor, which
      // is how a wrapped description stays with the movement it describes.
      const next = anchors[index + 1];
      const bottom = next ? next.item.y + gap : anchor.item.y - pitch;

      const cells = spec.headers.map(() => [] as PdfTextItem[]);
      for (const entry of placed) {
        if (entry.item.y > top || entry.item.y <= bottom) continue;
        cells[entry.column]?.push(entry.item);
      }

      const text = cells.map((items) =>
        items
          .sort((a, b) => b.y - a.y || a.x - b.x)
          .map((item) => item.text.trim())
          .filter((text) => text !== '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      );
      const required = spec.requiredColumns ?? [];
      const complete = required.every((label) => {
        const index = spec.headers.findIndex((header) => fold(header) === fold(label));
        return index >= 0 && (text[index] ?? '') !== '';
      });
      if (!complete) return;
      rows.push(text);
      rowLines.push(page.number);
    });
  }

  return {
    header: [...spec.headers],
    rows,
    delimiter: '',
    headerRow: 0,
    // A PDF has pages, not lines. An issue naming a page is what the owner can
    // actually go and look at.
    rowLines,
  };
}
