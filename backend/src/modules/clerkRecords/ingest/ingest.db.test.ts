import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import type { ListingForLookup, ListingMatchResult } from '../match/matchListing';
import type { ClerkDocumentRecord } from '../scrape/types';

// Runs the ingest SQL against a real, migrated Postgres, and only when CLERK_RECORDS_TEST_DATABASE_URL names one,
// e.g. the docker-compose database: never against a database by accident. It writes rows tagged CLERKTEST and
// deletes them afterwards.
const url = process.env.CLERK_RECORDS_TEST_DATABASE_URL;
const TAG = 'CLERKTEST';

type Database = typeof import('@sheriff-sale/database');
type LookupState = typeof import('./lookupState');

const document = (overrides: Partial<ClerkDocumentRecord>): ClerkDocumentRecord => ({
  county: 'Passaic',
  platform: 'press',
  instrumentNumber: `${TAG}-1`,
  docCategory: 'LIS_PENDENS',
  docTypeRaw: 'FORECLOSURE LIS PENDENS',
  recordedDate: '2026-03-02',
  bookType: null,
  book: null,
  page: null,
  municipality: 'CLIFTON CITY',
  block: '522',
  lot: '10',
  qualifier: null,
  extraLots: [],
  consideration: null,
  detail: null,
  parties: [
    { side: 'direct', name: 'SMITH JOHN' },
    { side: 'indirect', name: 'WELLS FARGO BANK NA' },
  ],
  links: [],
  ...overrides,
});

describe.skipIf(!url)('clerk-records ingest against Postgres', () => {
  let database: Database;
  let lookupState: LookupState;
  const listingIds: string[] = [];
  const now = DateTime.fromISO('2026-10-01T00:00:00Z', { zone: 'utc' });

  const count = async (table: string, where = 'TRUE') => {
    const [row] = await database.sql.unsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM "${table}" WHERE ${where}`,
    );

    return row.n;
  };

  const insertListing = async (sheriffId: string, saleDate: string): Promise<ListingForLookup> => {
    const [row] = await database.db
      .insert(database.listings)
      .values({ county: 'Passaic', sheriffId: `${TAG}-${sheriffId}`, saleDate, defendant: 'JOHN SMITH' })
      .returning({ id: database.listings.id });
    listingIds.push(row.id);

    return {
      id: row.id,
      county: 'Passaic',
      defendant: 'JOHN SMITH',
      plaintiff: null,
      courtCase: null,
      saleDate,
      city: null,
      parcel: null,
      description: null,
    };
  };

  const resultFor = (listing: ListingForLookup, documents: ClerkDocumentRecord[]): ListingMatchResult => ({
    listingId: listing.id,
    outcome: 'matched',
    documents,
    matches: documents.map(({ instrumentNumber }) => ({
      instrumentNumber,
      role: 'FORECLOSED_LIS_PENDENS',
      matchedBy: 'lis_pendens_party',
      confidence: 'high',
    })),
    unmappedDocTypes: [],
    truncatedSearches: 0,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    database = await import('@sheriff-sale/database');
    lookupState = await import('./lookupState');
  });

  afterAll(async () => {
    if (!database) {
      return;
    }

    await database.sql.unsafe(`DELETE FROM "Listing" WHERE "sheriffId" LIKE '${TAG}-%'`);
    await database.sql.unsafe(`DELETE FROM "ClerkDocument" WHERE "instrumentNumber" LIKE '${TAG}-%'`);
    await database.sql.end();
  });

  it('adds no rows when the same result is written twice', async () => {
    const listing = await insertListing('idempotent', '2026-12-01');
    const result = resultFor(listing, [document({ instrumentNumber: `${TAG}-idem` })]);

    await lookupState.saveLookupResult(listing, 'press', result, now);
    const counts = async () => [
      await count('ClerkDocument', `"instrumentNumber" = '${TAG}-idem'`),
      await count('ClerkDocumentParty'),
      await count('ListingClerkDocument', `"listingId" = '${listing.id}'`),
      await count('ListingClerkLookup', `"listingId" = '${listing.id}'`),
    ];
    const first = await counts();

    await lookupState.saveLookupResult(listing, 'press', result, now.plus({ days: 1 }));

    expect(first.slice(0, 1)).toEqual([1]);
    expect(await counts()).toEqual(first);
  });

  it('fills null columns but never blanks one', async () => {
    const listing = await insertListing('sparse', '2026-12-01');
    const instrumentNumber = `${TAG}-sparse`;

    await lookupState.saveLookupResult(
      listing,
      'press',
      resultFor(listing, [document({ instrumentNumber, book: null })]),
      now,
    );
    await lookupState.saveLookupResult(
      listing,
      'press',
      resultFor(listing, [document({ instrumentNumber, block: null, lot: null, book: 'OR-1', consideration: 712500 })]),
      now,
    );

    const [stored] = await database.sql.unsafe<Array<{ block: string; book: string; consideration: string }>>(
      `SELECT block, book, consideration FROM "ClerkDocument" WHERE "instrumentNumber" = '${instrumentNumber}'`,
    );
    expect(stored).toEqual({ block: '522', book: 'OR-1', consideration: '712500.00' });
  });

  it('leaves nothing when a write fails partway through', async () => {
    const listing = await insertListing('rollback', '2026-12-01');
    const instrumentNumber = `${TAG}-rollback`;
    const result = resultFor(listing, [document({ instrumentNumber })]);
    // A match whose document isn't in the result fails after the documents are inserted.
    result.matches.push({ ...result.matches[0], instrumentNumber: `${TAG}-missing` });

    await expect(lookupState.saveLookupResult(listing, 'press', result, now)).rejects.toThrow(/wasn't stored/);

    expect(await count('ClerkDocument', `"instrumentNumber" = '${instrumentNumber}'`)).toBe(0);
    expect(await count('ListingClerkLookup', `"listingId" = '${listing.id}'`)).toBe(0);

    await lookupState.recordLookupError(listing, 'press', new Error('boom'), now);
    expect(await count('ListingClerkLookup', `"listingId" = '${listing.id}' AND "lastOutcome" = 'error'`)).toBe(1);
  });

  it('cascades a deleted listing to its matches and lookup state, keeping the documents', async () => {
    const listing = await insertListing('cascade', '2026-12-01');
    const instrumentNumber = `${TAG}-cascade`;

    await lookupState.saveLookupResult(listing, 'press', resultFor(listing, [document({ instrumentNumber })]), now);
    await database.sql.unsafe(`DELETE FROM "Listing" WHERE id = '${listing.id}'`);

    expect(await count('ListingClerkDocument', `"listingId" = '${listing.id}'`)).toBe(0);
    expect(await count('ListingClerkLookup', `"listingId" = '${listing.id}'`)).toBe(0);
    expect(await count('ClerkDocument', `"instrumentNumber" = '${instrumentNumber}'`)).toBe(1);
  });

  it('selects due listings nearest sale first, and never a long-past sale or a stopped one', async () => {
    const runStart = DateTime.fromISO('2026-10-01T00:00:00Z', { zone: 'utc' });
    const soon = await insertListing('soon', '2026-10-05');
    const later = await insertListing('later', '2026-11-05');
    const longPast = await insertListing('long-past', '2026-06-01');
    const stopped = await insertListing('stopped', '2026-10-06');
    await lookupState.saveLookupResult(stopped, 'press', { ...resultFor(stopped, []), outcome: 'complete' }, runStart);

    const candidates = (await lookupState.selectCandidates('Passaic', runStart, 1_000)).map(({ id }) => id);

    expect(candidates).toEqual(expect.arrayContaining([soon.id, later.id]));
    expect(candidates.indexOf(soon.id)).toBeLessThan(candidates.indexOf(later.id));
    expect(candidates).not.toContain(longPast.id);
    expect(candidates).not.toContain(stopped.id);

    // The cap takes the nearest sales and leaves the rest due.
    expect((await lookupState.selectCandidates('Passaic', runStart, 1)).map(({ id }) => id)).toEqual([candidates[0]]);
  });
});
