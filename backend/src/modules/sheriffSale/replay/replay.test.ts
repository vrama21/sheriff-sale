import { readFixture } from '../__fixtures__/stubClientAdapter';
import { ListingSnapshot } from '../ingest/buildListingSnapshot';
import type { ListingSyncResult } from '../ingest/syncListing';
import { ReplayArgs } from './args';
import { countyPageKey, listingPageKey } from './plan';
import { formatReplaySummary, replayArchive, ReplayCounts } from './replay';

// A dry run must not load the database client, which connects to DATABASE_URL; replay.ts must never import it.
jest.mock('@sheriff-sale/database', () => {
  throw new Error('replay.ts loaded @sheriff-sale/database');
});

const countyPage = (...propertyIds: number[]) => `
  <table><tr><td><h1>County, NJ - Foreclosure Sales Listing</h1></td></tr></table>
  <table class="table table-striped ">
    <thead><tr><th></th><th>Sheriff #</th></tr></thead>
    ${propertyIds
      .map(
        (id) => `<tr><td class="hidden-print"><a href="/Sales/SaleDetails?PropertyId=${id}">View Details</a></td></tr>`,
      )
      .join('')}
  </table>`;

const CURRENT = readFixture('listingDetailsPassaic.html');
const LEGACY = readFixture('listingDetailsLegacySalem.html');
const HOME = readFixture('home.html');

// An in-memory archive: a key maps to its page, to an Error that reading it rejects with, or is missing.
let archive: Map<string, string | Error>;
const readText = jest.fn(async (key: string) => {
  const page = archive.get(key);

  if (page instanceof Error) {
    throw page;
  }

  return page;
});

// A fake database keyed like the real one: a snapshot already stored with the same hash is "unchanged", and a
// status row already seen on that date neither inserts nor extends.
let stored: Map<string, string>;
let seenStatusRows: Set<string>;
const syncListing = jest.fn(async (snapshot: ListingSnapshot): Promise<ListingSyncResult> => {
  const key = `${snapshot.listing.county}|${snapshot.listing.sheriffId}`;
  const previousHash = stored.get(key);
  stored.set(key, snapshot.contentHash);

  const newRows = snapshot.statusHistory
    .map((row) => `${key}|${row.status}|${row.date}|${snapshot.snapshotDate}`)
    .filter((row) => !seenStatusRows.has(row));
  newRows.forEach((row) => seenStatusRows.add(row));

  return {
    listing: previousHash === undefined ? 'inserted' : previousHash === snapshot.contentHash ? 'unchanged' : 'updated',
    statusInserted: newRows.length,
    statusExtended: 0,
  };
});

const args = (overrides: Partial<ReplayArgs> = {}): ReplayArgs => ({
  counties: ['Salem'],
  dates: ['2024-07-02'],
  dryRun: false,
  ...overrides,
});

const counts = (overrides: Partial<ReplayCounts>): ReplayCounts => ({
  countyPagesRead: 0,
  countyPagesMissing: 0,
  countyPagesFailed: 0,
  preFixDaysSkipped: 0,
  detailPagesFound: 0,
  detailPagesMissing: 0,
  detailPagesFailed: 0,
  unrecognised: 0,
  parseFailures: 0,
  noSheriffId: 0,
  fieldWarnings: 0,
  parsed: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  statusInserted: 0,
  statusExtended: 0,
  syncFailures: 0,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  stored = new Map();
  seenStatusRows = new Set();
  archive = new Map([
    [countyPageKey('2024-07-02', 'salem'), countyPage(1, 2, 3, 4)],
    [listingPageKey('2024-07-02', 1), CURRENT],
    [listingPageKey('2024-07-02', 2), LEGACY],
    [listingPageKey('2024-07-02', 3), HOME],
  ]);
});

describe('replayArchive', () => {
  it('syncs current and legacy pages, and counts the home page and a missing detail page', async () => {
    const summary = await replayArchive(args(), { readText, syncListing });

    expect(summary.byCounty.get('Salem')).toEqual(
      counts({
        countyPagesRead: 1,
        detailPagesFound: 4,
        detailPagesMissing: 1,
        unrecognised: 1,
        parsed: 2,
        inserted: 2,
        statusInserted: 5 + 3,
      }),
    );
    expect(summary.failed).toBe(false);
    expect(syncListing).toHaveBeenCalledTimes(2);
    expect(syncListing.mock.calls.map(([snapshot]) => snapshot.listing)).toEqual([
      expect.objectContaining({ county: 'Salem', sheriffId: 'F-23001318', propertyId: 1 }),
      expect.objectContaining({
        county: 'Salem',
        sheriffId: 'F-24000056',
        propertyId: 2,
        street: '263 Three Bridge Road',
      }),
    ]);
    expect(syncListing.mock.calls.every(([snapshot]) => snapshot.snapshotDate === '2024-07-02')).toBe(true);
  });

  it('counts a missing county page and carries on with the next day', async () => {
    archive.set(countyPageKey('2024-07-03', 'salem'), countyPage(5));
    archive.set(listingPageKey('2024-07-03', 5), LEGACY);
    archive.delete(countyPageKey('2024-07-02', 'salem'));

    const summary = await replayArchive(args({ dates: ['2024-07-02', '2024-07-03'] }), { readText, syncListing });

    expect(summary.total).toMatchObject({
      countyPagesRead: 1,
      countyPagesMissing: 1,
      detailPagesFound: 1,
      inserted: 1,
    });
    expect(summary.failed).toBe(false);
  });

  it('reads both slugs for Gloucester before the fix, syncs them as Gloucester, and skips Passaic', async () => {
    archive = new Map([
      [countyPageKey('2025-05-01', 'gloucester'), countyPage(11)],
      [countyPageKey('2025-05-01', 'passaic'), countyPage(11, 12)],
      [listingPageKey('2025-05-01', 11), CURRENT],
      [listingPageKey('2025-05-01', 12), LEGACY],
    ]);

    const summary = await replayArchive(args({ counties: ['Gloucester', 'Passaic'], dates: ['2025-05-01'] }), {
      readText,
      syncListing,
    });

    expect(summary.byCounty.get('Gloucester')).toMatchObject({ countyPagesRead: 2, detailPagesFound: 2, parsed: 2 });
    expect(summary.byCounty.get('Passaic')).toEqual(counts({ preFixDaysSkipped: 1 }));
    expect(syncListing.mock.calls.map(([snapshot]) => snapshot.listing.county)).toEqual(['Gloucester', 'Gloucester']);
    expect(readText.mock.calls.filter(([key]) => key === listingPageKey('2025-05-01', 11))).toHaveLength(1);
    expect(formatReplaySummary(summary, false).join('\n')).toContain('1 days skipped as pre-fix');
  });

  it('counts a page without a sheriff number and a page that fails to parse, and writes neither', async () => {
    archive.set(listingPageKey('2024-07-02', 1), CURRENT.replace('F-23001318', ''));
    archive.set(listingPageKey('2024-07-02', 2), '<div class="sale-detail-item"></div>');

    const summary = await replayArchive(args(), { readText, syncListing });

    expect(summary.total).toMatchObject({ noSheriffId: 1, parseFailures: 1, parsed: 0 });
    expect(syncListing).not.toHaveBeenCalled();
    expect(summary.failed).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      'Failed to parse listing-html-files/2024-07-02/property-id-2.html',
      expect.any(Error),
    );
  });

  it('counts and logs field warnings, and still syncs the page', async () => {
    archive.set(listingPageKey('2024-07-02', 2), LEGACY.replace('$275,983.46', 'TBD'));

    const summary = await replayArchive(args(), { readText, syncListing });

    expect(summary.total).toMatchObject({ fieldWarnings: 1, parsed: 2, inserted: 2 });
    expect(summary.failed).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      'Field warning for listing-html-files/2024-07-02/property-id-2.html: upsetAmount "TBD" is not a dollar amount',
    );
  });

  it('counts failed reads, keeps going, and fails the run', async () => {
    archive.set(listingPageKey('2024-07-02', 2), new Error('AccessDenied'));

    const summary = await replayArchive(args(), { readText, syncListing });

    expect(summary.total).toMatchObject({ detailPagesFailed: 1, inserted: 1 });
    expect(summary.failed).toBe(true);
    expect(console.error).toHaveBeenCalledWith(
      'Failed to read listing-html-files/2024-07-02/property-id-2.html',
      expect.objectContaining({ message: 'AccessDenied' }),
    );
  });

  it('fails the run when a county page cannot be read', async () => {
    archive.set(countyPageKey('2024-07-02', 'salem'), new Error('socket hang up'));

    const summary = await replayArchive(args(), { readText, syncListing });

    expect(summary.total).toMatchObject({ countyPagesFailed: 1, detailPagesFound: 0 });
    expect(summary.failed).toBe(true);
  });

  it('logs and counts a failed sync, syncs the other listings, and fails the run', async () => {
    syncListing.mockRejectedValueOnce(new Error('connection refused'));

    const summary = await replayArchive(args(), { readText, syncListing });

    expect(summary.total).toMatchObject({ syncFailures: 1, inserted: 1, parsed: 2 });
    expect(summary.failed).toBe(true);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/^Failed to sync listing-html-files\/2024-07-02\/property-id-[12]\.html$/),
      expect.objectContaining({ message: 'connection refused' }),
    );
  });

  it('reads and parses on a dry run, with the same page counts, and never syncs', async () => {
    const real = await replayArchive(args(), { readText, syncListing });
    syncListing.mockClear();

    const dry = await replayArchive(args({ dryRun: true }), { readText, syncListing });

    expect(syncListing).not.toHaveBeenCalled();
    expect(dry.total).toEqual({ ...real.total, inserted: 0, statusInserted: 0 });
    expect(formatReplaySummary(dry, true)).toContain('  listings not synced (dry run)');
  });

  it('reports zero writes when re-run over a range it has already replayed', async () => {
    archive.set(countyPageKey('2024-07-03', 'salem'), countyPage(5));
    archive.set(listingPageKey('2024-07-03', 5), LEGACY);
    const range = args({ dates: ['2024-07-02', '2024-07-03'] });

    await replayArchive(range, { readText, syncListing });
    const rerun = await replayArchive(range, { readText, syncListing });

    expect(rerun.total).toMatchObject({ inserted: 0, updated: 0, unchanged: 3, statusInserted: 0, statusExtended: 0 });
    expect(rerun.failed).toBe(false);
  });

  it('caps detail pages in flight', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => 100 + i);
    archive.set(countyPageKey('2024-07-02', 'salem'), countyPage(...ids));
    let active = 0;
    let maxActive = 0;
    readText.mockImplementation(async (key: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;

      return key.startsWith('county') ? (archive.get(key) as string) : HOME;
    });

    const summary = await replayArchive(args(), { readText, syncListing });

    expect(summary.total.unrecognised).toBe(30);
    expect(maxActive).toBe(8);
  });
});
