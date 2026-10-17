import { sqlLiteral, summarize, toMigrationSql, toReportCsv } from './output';
import { ExportedListing, planRow } from './plan';

const exportedRow = (overrides: Partial<ExportedListing>): ExportedListing => ({
  id: 'listing-1',
  county: 'Salem',
  state: 'NJ',
  address: '',
  city: null,
  street: null,
  zipcode: null,
  unit: null,
  secondaryUnit: null,
  saleDate: '7/5/2023',
  ...overrides,
});

const hancocksBridge = exportedRow({
  id: 'hancocks-bridge',
  address: "\r 16 New Street and Maple AvenueHancock's Bridge NJ 08038   ",
  city: '',
  saleDate: '\r 7/5/2023   ',
});
const alreadyCorrect = exportedRow({ id: 'already-correct', address: '', city: null });
const unresolved = exportedRow({
  id: 'unresolved',
  address: '56 KENWOOD DRIVEUNIT 56WINSLOW TWP NJ 08081',
  city: null,
});

describe('sqlLiteral', () => {
  it.each([
    [null, 'NULL'],
    ['', "''"],
    ["Hancock's Bridge", "'Hancock''s Bridge'"],
    ['\r 7/5/2023   ', "E'\\r 7/5/2023   '"],
    ["O'Neil\\Unit\n2\t", "E'O''Neil\\\\Unit\\n2\\t'"],
  ])('writes %j as %s', (value, expected) => {
    expect(sqlLiteral(value)).toBe(expected);
  });
});

describe('toMigrationSql', () => {
  const sql = toMigrationSql([hancocksBridge, alreadyCorrect, unresolved].map(planRow));

  it('updates only rows with changes', () => {
    expect(sql).toContain("('hancocks-bridge', ");
    expect(sql).not.toContain('already-correct');
    expect(sql).not.toContain("'unresolved'");
  });

  it('escapes quotes and carriage returns in the values', () => {
    expect(sql).toContain(
      "('hancocks-bridge', E'\\r 16 New Street and Maple AvenueHancock''s Bridge NJ 08038   ', '', E'\\r 7/5/2023   ', " +
        "'16 New Street and Maple Avenue Hancock''s Bridge NJ 08038', 'Hancock''s Bridge', " +
        "'16 New Street And Maple Avenue', '08038', '', '', '7/5/2023')",
    );
  });

  it('guards every update on the exported address, city and sale date', () => {
    expect(sql).toContain('WHERE "l"."id" = "v"."id"');
    expect(sql).toContain('"l"."address" IS NOT DISTINCT FROM "v"."oldAddress"');
    expect(sql).toContain('"l"."city" IS NOT DISTINCT FROM "v"."oldCity"');
    expect(sql).toContain('"l"."saleDate" IS NOT DISTINCT FROM "v"."oldSaleDate"');
  });

  it('never writes state', () => {
    expect(sql).not.toContain('"state"');
  });

  it('splits large plans into several statements', () => {
    const rows = Array.from({ length: 1001 }, (_, i) => exportedRow({ id: `listing-${i}`, city: '' }));
    const statements = toMigrationSql(rows.map(planRow)).split('--> statement-breakpoint');

    expect(statements).toHaveLength(3);
    statements.forEach((statement) => expect(statement).toMatch(/^UPDATE "Listing"/m));
  });

  it('writes only the header when nothing changes', () => {
    expect(toMigrationSql([planRow(alreadyCorrect)])).not.toContain('UPDATE');
  });

  it('refuses a value longer than its varchar column', () => {
    const longStreet = `${'1'.repeat(250)} MAIN STREETNEWARK NJ 07112`;

    expect(() => toMigrationSql([planRow(exportedRow({ address: longStreet }))])).toThrow(/street/);
  });
});

describe('toReportCsv', () => {
  const lines = toReportCsv([hancocksBridge, alreadyCorrect, unresolved].map(planRow)).trimEnd().split('\n');

  it('lists planned updates and blank and unresolved rows, with old and new values', () => {
    expect(lines[0]).toMatch(/^id,county,outcome,changed,old address,new address,old city,new city,/);
    expect(lines.slice(1).map((line) => line.split(',')[0])).toEqual([
      'hancocks-bridge',
      'already-correct',
      'unresolved',
    ]);
  });

  it("writes NULL for a database NULL and nothing for ''", () => {
    expect(lines[2]).toBe(
      'already-correct,Salem,blank,,,,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,7/5/2023,7/5/2023',
    );
  });

  it('quotes values with quotes, commas, carriage returns or padding', () => {
    expect(lines[1]).toContain(',"\r 16 New Street and Maple AvenueHancock\'s Bridge NJ 08038   ",');
  });
});

describe('summarize', () => {
  it('counts rows by outcome and by what happens to their city', () => {
    const summary = summarize([hancocksBridge, alreadyCorrect, unresolved].map(planRow));

    expect(summary).toMatchObject({
      exported: 3,
      alreadyCorrect: 2,
      plannedUpdates: 1,
      plannedByOutcome: { 'case boundary': 1, blank: 0, unresolved: 0 },
      rowsByOutcome: { 'case boundary': 1, blank: 1, unresolved: 1 },
      city: { filled: 1, corrected: 0, cleared: 0, unchanged: 2 },
    });
  });
});
