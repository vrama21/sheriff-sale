import { describe, expect, it } from 'vite-plus/test';
import { readPressFixture } from '../../../__fixtures__/readFixture';
import { ClerkParseError } from '../../../scrape/types';
import { groupPressRows, parsePressResultGrid, PressGridRow } from './parsePressResultGrid';

const results = (county: Parameters<typeof readPressFixture>[0], name: string) => {
  const page = parsePressResultGrid(readPressFixture(county, name), `${county} ${name}`);

  if (page.kind !== 'results') {
    throw new Error(`expected results in ${county}/${name}`);
  }

  return page;
};

describe('parsePressResultGrid', () => {
  it('reads Passaic rows, with N/A and empty cells as null', () => {
    const { rows } = results('passaic', 'name-lis-pendens');

    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual({
      type: 'FORECLOSURE LIS PENDENS',
      direct: 'CABIGAO CORAZON',
      indirect: 'RRA CP OPPORTUNITY TRUST 2',
      instrument: '2025037241',
      recorded: '11/5/2025',
      town: 'CLIFTON CITY',
      block: null,
      lot: null,
      qualifier: null,
      book: null,
      page: null,
    });
  });

  it('reads Burlington’s Qualifier and Action columns by header', () => {
    const { rows } = results('burlington', 'name-all-types');
    const lisPendens = rows.find((row) => row.type === 'LIS PENDENS');

    expect(lisPendens).toMatchObject({
      direct: 'LUNDY NAJEE',
      indirect: 'AMERICAN NEIGHBORHOOD MTG ACCEPTANCE CO',
      instrument: '5908403',
      recorded: '8/14/2024',
      town: 'HAINESPORT TWP',
      block: '47.02',
      lot: '11',
      book: 'OR-13730',
      page: '1723',
    });
  });

  it.each([
    ['essex', 'name-all-types'],
    ['essex', 'parcel'],
    ['passaic', 'name-all-types'],
    ['monmouth', 'name-all-types'],
    ['monmouth', 'parcel'],
    ['monmouth', 'parcel-page2'],
    ['burlington', 'parcel'],
    ['burlington', 'parcel-page2'],
  ] as const)('reads every row of %s/%s with a type, a party and a date', (county, name) => {
    const { rows } = results(county, name);

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row.type).not.toBe('');
      expect(row.direct ?? row.indirect).toBeTruthy();
      expect(row.recorded).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
      expect(row.instrument ?? row.book).toBeTruthy();
    }
  });

  it('reads the pager’s page links', () => {
    const { pager } = results('monmouth', 'parcel');

    expect(pager.currentPage).toBe(1);
    expect([...pager.pageTargets.keys()]).toEqual([2, 3, 4]);
    expect(pager.pageTargets.get(2)).toBe('ctl00$ContentPlaceHolder1$dgdDeedMort$ctl01$ctl01');
    expect(results('monmouth', 'parcel-page2').pager.currentPage).toBe(2);
    expect(results('burlington', 'parcel').pager.pageTargets.size).toBe(4);
  });

  it('has no page links on a single page', () => {
    expect(results('passaic', 'name-all-types').pager.pageTargets.size).toBe(0);
  });

  it.each(['essex', 'passaic', 'monmouth', 'burlington'] as const)(
    'reads %s’s no-records answer as empty',
    (county) => {
      expect(parsePressResultGrid(readPressFixture(county, 'no-records'), county)).toEqual({ kind: 'no_records' });
    },
  );

  it('fails on a page with neither a grid nor the no-records message', () => {
    expect(() => parsePressResultGrid(readPressFixture('passaic', 'date-range-error'), 'Passaic name search')).toThrow(
      new ClerkParseError(
        `PRESS results page not recognised for Passaic name search: portal said "Date Range should not be more than '90' days."`,
      ),
    );
    expect(() => parsePressResultGrid(readPressFixture('essex', 'entry'), 'Essex name search')).toThrow(
      ClerkParseError,
    );
    expect(() => parsePressResultGrid('<html><body>Server Error</body></html>', 'Essex')).toThrow(/no results grid/);
  });
});

describe('groupPressRows', () => {
  const row = (overrides: Partial<PressGridRow>): PressGridRow => ({
    type: 'MORTGAGE',
    direct: null,
    indirect: null,
    instrument: '2026051225',
    recorded: '5/1/2026',
    town: 'CLIFTON CITY',
    block: null,
    lot: null,
    qualifier: null,
    book: null,
    page: null,
    ...overrides,
  });

  it('groups one document’s party rows with the union of its parties', () => {
    const directs = ['SMITH JOHN', 'SMITH JANE', 'DOE RICHARD', 'ROE MARY'];
    const indirects = ['BANK A', 'BANK B', 'BANK C'];
    const rows = directs.flatMap((direct) => indirects.map((indirect) => row({ direct, indirect }))).slice(0, 12);

    const { documents } = groupPressRows(rows);

    expect(documents).toHaveLength(1);
    expect(documents[0].direct).toEqual(directs);
    expect(documents[0].indirect).toEqual(indirects);
  });

  it('takes parcel and book from the first row that has them, keeping other lots of the block as extra lots', () => {
    const { documents } = groupPressRows(
      results('burlington', 'name-all-types').rows.filter((gridRow) => gridRow.instrument === '5908403'),
    );

    expect(documents).toEqual([
      expect.objectContaining({ block: '47.02', lot: '11', extraLots: ['11.01'], book: 'OR-13730', page: '1723' }),
    ]);
  });

  it('keys a book-only record by book and page, and returns keyless rows', () => {
    const { documents, keyless } = groupPressRows([
      row({ instrument: null, book: '5120', page: '88', direct: 'A B' }),
      row({ instrument: null, direct: 'C D' }),
    ]);

    expect(documents.map((document) => [document.instrumentNumber, document.book, document.page])).toEqual([
      [null, '5120', '88'],
    ]);
    expect(keyless).toHaveLength(1);
  });

  it('groups Monmouth’s lis pendens into one document per instrument', () => {
    const { documents } = groupPressRows(results('monmouth', 'name-all-types').rows);
    const lisPendens = documents.find((document) => document.instrumentNumber === '2023027660');

    expect(lisPendens).toMatchObject({
      docTypeRaw: 'FORECLOSURE LISPENDENS',
      direct: ['HUBBARD NICHOLAS JR', 'HUBBARD NICHOLAS SR', 'VALENZANO KRISTIN'],
      indirect: ['GUARANTEED RATE INC'],
      town: 'MIDDLETOWN',
      block: '446',
      lot: '4',
    });
  });
});
