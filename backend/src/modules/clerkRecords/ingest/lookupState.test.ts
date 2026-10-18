import { db } from '@sheriff-sale/database';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vite-plus/test';
import { ListingMatchResult } from '../match/matchListing';
import { recordLookupError, saveLookupResult } from './lookupState';
import { syncClerkDocuments } from './syncClerkDocuments';
import { syncListingMatches } from './syncListingMatches';

vi.mock('@sheriff-sale/database', () => ({
  and: vi.fn(),
  asc: vi.fn(),
  db: { transaction: vi.fn() },
  drizzleSql: Object.assign(vi.fn(), { raw: vi.fn() }),
  eq: vi.fn(),
  gte: vi.fn(),
  isNull: vi.fn(),
  lte: vi.fn(),
  or: vi.fn(),
  listingClerkLookups: { listingId: 'ListingClerkLookup.listingId' },
  listings: {},
}));
vi.mock('./syncClerkDocuments', () => ({ syncClerkDocuments: vi.fn() }));
vi.mock('./syncListingMatches', () => ({ syncListingMatches: vi.fn() }));

const transaction = vi.mocked(db).transaction as unknown as Mock;
const now = DateTime.fromISO('2026-10-01T00:00:00Z', { zone: 'utc' });
const listing = {
  id: 'listing-1',
  county: 'Passaic' as const,
  defendant: 'JOHN SMITH',
  plaintiff: 'BANK',
  courtCase: 'F-000001-26',
  saleDate: '2026-12-01',
  city: 'Clifton',
  parcel: null,
  description: null,
};
const result: ListingMatchResult = {
  listingId: 'listing-1',
  outcome: 'no_lis_pendens',
  documents: [],
  matches: [],
  unmappedDocTypes: [],
  truncatedSearches: 0,
};

/** A transaction whose lookup-state reads return `stored` and whose upsert records its values. */
const fakeTx = (stored: Array<{ consecutiveMisses: number; consecutiveErrors: number }>) => {
  const written: Array<Record<string, unknown>> = [];
  const tx = {
    select: () => ({ from: () => ({ where: async () => stored }) }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          written.push(values);
        },
      }),
    }),
  };

  return { tx, written };
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('saveLookupResult', () => {
  it('writes documents, matches and lookup state in one transaction', async () => {
    const { tx, written } = fakeTx([{ consecutiveMisses: 1, consecutiveErrors: 0 }]);
    transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(tx));
    vi.mocked(syncClerkDocuments).mockResolvedValue(new Map());
    vi.mocked(syncListingMatches).mockResolvedValue(0);

    await saveLookupResult(listing, 'press', result, now);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(syncClerkDocuments).toHaveBeenCalledWith(tx, [], now.toJSDate());
    // The listing's second miss in a row: 7 days later.
    expect(written).toEqual([
      expect.objectContaining({
        listingId: 'listing-1',
        platform: 'press',
        lastOutcome: 'no_lis_pendens',
        consecutiveMisses: 2,
        nextCheckAt: new Date('2026-10-08T00:00:00Z'),
      }),
    ]);
  });

  it('rejects, writing nothing more, when a write inside the transaction fails', async () => {
    const { tx, written } = fakeTx([]);
    transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(tx));
    vi.mocked(syncClerkDocuments).mockResolvedValue(new Map([['1', 'doc-1']]));
    vi.mocked(syncListingMatches).mockRejectedValue(new Error('insert failed'));

    await expect(saveLookupResult(listing, 'press', result, now)).rejects.toThrow('insert failed');
    expect(written).toEqual([]);
  });
});

describe('recordLookupError', () => {
  it('records the error in its own transaction, counting consecutive errors', async () => {
    const { tx, written } = fakeTx([{ consecutiveMisses: 2, consecutiveErrors: 4 }]);
    transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(tx));

    await recordLookupError(listing, 'press', new Error('socket hang up'), now);

    expect(written).toEqual([
      expect.objectContaining({
        lastOutcome: 'error',
        consecutiveErrors: 5,
        consecutiveMisses: 2,
        lastError: 'Error: socket hang up',
        nextCheckAt: new Date('2026-10-08T00:00:00Z'),
      }),
    ]);
  });
});
