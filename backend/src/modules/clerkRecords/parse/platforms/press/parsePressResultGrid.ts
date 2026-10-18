import { HTMLElement, parse } from 'node-html-parser';
import { ClerkParseError } from '../../../scrape/types';

// PRESS's results grid, `dgdDeedMort`: one row per direct/indirect party pair of each document, under a header whose
// party columns are named for the doc type (Direct Party, Mortgagor, Grantor). Burlington adds a Qualifier column, and
// Monmouth and Burlington an Action column, so columns other than the first three are found by header text.

export type PressGridRow = {
  type: string;
  direct: string | null;
  indirect: string | null;
  instrument: string | null;
  recorded: string | null;
  town: string | null;
  block: string | null;
  lot: string | null;
  qualifier: string | null;
  book: string | null;
  page: string | null;
};

export type PressPager = {
  currentPage: number;
  /** `__EVENTTARGET` of each page link the pager shows, by page number. */
  pageTargets: Map<number, string>;
  /** The `...` link to the next block of pages, when the pager has one. */
  moreTarget: string | null;
};

export type ParsedPressPage = { kind: 'results'; rows: PressGridRow[]; pager: PressPager } | { kind: 'no_records' };

/** The grouped rows of one document, before validation. */
export type PressDocumentRows = {
  instrumentNumber: string | null;
  docTypeRaw: string;
  recorded: string | null;
  town: string | null;
  block: string | null;
  lot: string | null;
  extraLots: string[];
  qualifier: string | null;
  book: string | null;
  page: string | null;
  direct: string[];
  indirect: string[];
};

const NO_RECORDS = /no\s+results\s+found/i;

const cellText = (cell: HTMLElement | undefined): string | null => {
  const text = cell?.text.replace(/\s+/g, ' ').trim();

  return text && text.toUpperCase() !== 'N/A' ? text : null;
};

const headerKey = (text: string): string => text.toLowerCase().replace(/[^a-z]/g, '');

const COLUMN_KEYS: Record<string, keyof PressGridRow> = {
  instrument: 'instrument',
  recorded: 'recorded',
  townname: 'town',
  town: 'town',
  block: 'block',
  lot: 'lot',
  qualifier: 'qualifier',
  book: 'book',
  page: 'page',
};

const isPagerRow = (row: HTMLElement): boolean => {
  const cells = row.querySelectorAll('td');

  return cells.length === 1 && cells[0].hasAttribute('colspan');
};

const readPager = (rows: HTMLElement[]): PressPager => {
  const pager: PressPager = { currentPage: 1, pageTargets: new Map(), moreTarget: null };
  const row = rows.find(isPagerRow);

  if (!row) {
    return pager;
  }

  const current = Number(row.querySelector('span')?.text.trim());

  if (Number.isInteger(current) && current > 0) {
    pager.currentPage = current;
  }

  for (const link of row.querySelectorAll('a')) {
    const target = /__doPostBack\('([^']+)'/.exec((link.getAttribute('href') ?? '').replace(/&#39;/g, "'"))?.[1];
    const label = link.text.trim();

    if (!target) {
      continue;
    }

    if (/^\d+$/.test(label)) {
      pager.pageTargets.set(Number(label), target);
    } else if (label === '...' && Number(row.querySelectorAll('a').at(-1)?.text.trim()) !== pager.currentPage) {
      pager.moreTarget = target;
    }
  }

  return pager;
};

/**
 * Reads a PRESS results page. A page without the grid is the no-records answer only when the portal says so; anything
 * else, such as an error page, a date-range complaint or a changed layout, throws a ClerkParseError naming `context`.
 */
export const parsePressResultGrid = (html: string, context: string): ParsedPressPage => {
  const root = parse(html);
  const grid = root.querySelector('table[id$=dgdDeedMort]');

  if (!grid) {
    const message = root
      .querySelectorAll('[id$=lblMessage]')
      .map((label) => label.text.trim())
      .filter(Boolean)
      .join(' ');

    if (NO_RECORDS.test(message)) {
      return { kind: 'no_records' };
    }

    throw new ClerkParseError(
      `PRESS results page not recognised for ${context}: ${message ? `portal said "${message}"` : 'no results grid'}`,
    );
  }

  const rows = grid.querySelectorAll('tr');
  const headerIndex = rows.findIndex((row) => headerKey(row.querySelector('td,th')?.text ?? '') === 'type');

  if (headerIndex === -1) {
    throw new ClerkParseError(`PRESS results grid for ${context} has no header row`);
  }

  const headers = rows[headerIndex].querySelectorAll('td,th').map((cell) => headerKey(cell.text));
  const columns = new Map<keyof PressGridRow, number>([
    ['type', 0],
    ['direct', 1],
    ['indirect', 2],
  ]);

  headers.forEach((key, index) => {
    const column = Object.entries(COLUMN_KEYS).find(([prefix]) => key.startsWith(prefix))?.[1];

    if (index > 2 && column && !columns.has(column)) {
      columns.set(column, index);
    }
  });

  for (const required of ['instrument', 'recorded', 'book', 'page'] as const) {
    if (!columns.has(required)) {
      throw new ClerkParseError(`PRESS results grid for ${context} has no ${required} column`);
    }
  }

  const dataRows = rows
    .slice(headerIndex + 1)
    .filter((row) => !isPagerRow(row) && row.querySelectorAll('td').length >= headers.length - 1);

  const parsedRows = dataRows.map((row): PressGridRow => {
    const cells = row.querySelectorAll('td');
    const value = (key: keyof PressGridRow) => {
      const index = columns.get(key);

      return index === undefined ? null : cellText(cells[index]);
    };

    return {
      type: value('type') ?? '',
      direct: value('direct'),
      indirect: value('indirect'),
      instrument: value('instrument'),
      recorded: value('recorded'),
      town: value('town'),
      block: value('block'),
      lot: value('lot'),
      qualifier: value('qualifier'),
      book: value('book'),
      page: value('page'),
    };
  });

  return { kind: 'results', rows: parsedRows, pager: readPager(rows) };
};

/** A document's key: its instrument number, or `BK:<book>/<page>` when the index has none (design D2). */
export const documentKey = (row: Pick<PressGridRow, 'instrument' | 'book' | 'page'>): string | null => {
  if (row.instrument) {
    return row.instrument;
  }

  return row.book && row.page ? `BK:${row.book}/${row.page}` : null;
};

/**
 * Groups grid rows, from one page or several, into documents (design D4): one per instrument number, with the union of
 * its direct and indirect parties, and town, block, lot and book/page from the first row that has them. A document
 * indexed against several lots of one block (Burlington's `47.02/11` and `47.02/11.01`) keeps the others as extra lots.
 * Rows with neither an instrument number nor a book and page come back in `keyless` for the caller to reject.
 */
export const groupPressRows = (rows: PressGridRow[]): { documents: PressDocumentRows[]; keyless: PressGridRow[] } => {
  const byKey = new Map<string, PressDocumentRows>();
  const keyless: PressGridRow[] = [];

  for (const row of rows) {
    const key = documentKey(row);

    if (!key) {
      keyless.push(row);
      continue;
    }

    const document = byKey.get(key) ?? {
      instrumentNumber: row.instrument,
      docTypeRaw: row.type,
      recorded: row.recorded,
      town: null,
      block: null,
      lot: null,
      extraLots: [],
      qualifier: null,
      book: null,
      page: null,
      direct: [],
      indirect: [],
    };

    byKey.set(key, document);

    document.recorded ??= row.recorded;
    document.town ??= row.town;
    document.qualifier ??= row.qualifier;

    if (!document.book && row.book) {
      document.book = row.book;
      document.page = row.page;
    }

    if (!document.block && row.block) {
      document.block = row.block;
      document.lot = row.lot;
    } else if (row.lot && row.block === document.block && row.lot !== document.lot && !document.extraLots.includes(row.lot)) {
      document.extraLots.push(row.lot);
    }

    if (row.direct && !document.direct.includes(row.direct)) {
      document.direct.push(row.direct);
    }

    if (row.indirect && !document.indirect.includes(row.indirect)) {
      document.indirect.push(row.indirect);
    }
  }

  return { documents: [...byKey.values()], keyless };
};
