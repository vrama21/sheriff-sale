import { db, listings, statusHistories } from '@sheriff-sale/database';
import { buildListingSnapshot, ListingSnapshot } from './buildListingSnapshot';
import { syncListing } from './syncListing';

jest.mock('@sheriff-sale/database', () => ({
  and: jest.fn(),
  db: { transaction: jest.fn() },
  drizzleSql: Object.assign(jest.fn(), { raw: jest.fn() }),
  eq: jest.fn(),
  listings: { id: 'Listing.id', county: 'Listing.county', sheriffId: 'Listing.sheriffId' },
  statusHistories: { listingId: 'StatusHistory.listingId', status: 'StatusHistory.status', date: 'StatusHistory.date' },
}));

const transaction = jest.mocked(db).transaction as unknown as jest.Mock;

type StoredListing = { id: string; contentHash: string | null; snapshotDate: string | null };
type StoredStatus = { firstSeenOn: string; lastSeenOn: string };
type StatusValues = { listingId: string; status: string; date: string; firstSeenOn: string; lastSeenOn: string };

// A fake database that applies the upsert rules of syncListing's SQL, buffering writes until the transaction's
// callback resolves, so a rejected transaction stores nothing.
let storedListings: Map<string, StoredListing>;
let storedStatuses: Map<string, StoredStatus>;
const statusInsert = jest.fn();
const listingSelect = jest.fn();
const conflictTargets = jest.fn();

const fakeTransaction = async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
  const pendingListings = new Map(storedListings);
  const pendingStatuses = new Map(storedStatuses);

  const tx = {
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: (config: { target: unknown }) => ({
          returning: async () => {
            conflictTargets(config.target);

            if (table === listings) {
              const listing = values as ListingSnapshot['listing'] & { contentHash: string; snapshotDate: string };
              const key = `${listing.county}|${listing.sheriffId}`;
              const stored = pendingListings.get(key);

              if (!stored) {
                const id = `listing-${pendingListings.size + 1}`;
                pendingListings.set(key, { id, contentHash: listing.contentHash, snapshotDate: listing.snapshotDate });

                return [{ id, inserted: true }];
              }

              const changed = stored.contentHash !== listing.contentHash;
              const asNew = stored.snapshotDate === null || listing.snapshotDate >= stored.snapshotDate;

              if (!changed || !asNew) {
                return [];
              }

              pendingListings.set(key, {
                ...stored,
                contentHash: listing.contentHash,
                snapshotDate: listing.snapshotDate,
              });

              return [{ id: stored.id, inserted: false }];
            }

            if (table !== statusHistories) {
              throw new Error('unexpected table');
            }

            await statusInsert(values);

            return (values as StatusValues[]).flatMap((row) => {
              const key = `${row.listingId}|${row.status}|${row.date}`;
              const stored = pendingStatuses.get(key);

              if (!stored) {
                pendingStatuses.set(key, { firstSeenOn: row.firstSeenOn, lastSeenOn: row.lastSeenOn });

                return [{ inserted: true }];
              }

              if (row.firstSeenOn >= stored.firstSeenOn && row.lastSeenOn <= stored.lastSeenOn) {
                return [];
              }

              pendingStatuses.set(key, {
                firstSeenOn: row.firstSeenOn < stored.firstSeenOn ? row.firstSeenOn : stored.firstSeenOn,
                lastSeenOn: row.lastSeenOn > stored.lastSeenOn ? row.lastSeenOn : stored.lastSeenOn,
              });

              return [{ inserted: false }];
            });
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: async () => {
          listingSelect();

          return [...pendingListings.values()].slice(0, 1).map(({ id }) => ({ id }));
        },
      }),
    }),
  };

  const result = await callback(tx);
  storedListings = pendingListings;
  storedStatuses = pendingStatuses;

  return result;
};

const snapshot = (
  snapshotDate: string,
  {
    upsetAmount = '$1.00',
    propertyId = 1319120858,
    sheriffId = 'F-24000056',
    rows = [['Scheduled', '7/20/2023']],
  } = {},
) =>
  buildListingSnapshot({
    page: {
      listing: { sheriffId, upsetAmount, address: '1 Main Street\nTrenton NJ 08608' },
      statusHistory: rows.map(([status, date]) => ({ status, date })),
    },
    county: 'Gloucester',
    propertyId,
    snapshotDate,
  });

beforeEach(() => {
  jest.clearAllMocks();
  storedListings = new Map();
  storedStatuses = new Map();
  statusInsert.mockResolvedValue(undefined);
  transaction.mockImplementation(fakeTransaction);
});

describe('syncListing', () => {
  it('inserts a new listing and its status rows, seen on the snapshot date', async () => {
    await expect(syncListing(snapshot('2025-03-01'))).resolves.toEqual({
      listing: 'inserted',
      statusInserted: 1,
      statusExtended: 0,
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(conflictTargets.mock.calls).toEqual([
      [[listings.county, listings.sheriffId]],
      [[statusHistories.listingId, statusHistories.status, statusHistories.date]],
    ]);
    expect(statusInsert).toHaveBeenCalledWith([
      {
        listingId: 'listing-1',
        status: 'Scheduled',
        date: '2023-07-20',
        firstSeenOn: '2025-03-01',
        lastSeenOn: '2025-03-01',
      },
    ]);
  });

  it('updates the listing from a newer snapshot with changed fields', async () => {
    await syncListing(snapshot('2025-03-01'));

    await expect(syncListing(snapshot('2025-03-08', { upsetAmount: '$2.00', propertyId: 2 }))).resolves.toEqual({
      listing: 'updated',
      statusInserted: 0,
      statusExtended: 1,
    });
    expect(listingSelect).not.toHaveBeenCalled();
  });

  it('reports unchanged and still merges status rows when only the propertyId differs', async () => {
    await syncListing(snapshot('2025-03-01'));

    await expect(
      syncListing(snapshot('2025-06-10', { propertyId: 2195502430, rows: [['Cancelled', '4/9/2025']] })),
    ).resolves.toEqual({ listing: 'unchanged', statusInserted: 1, statusExtended: 0 });

    expect(listingSelect).toHaveBeenCalledTimes(1);
    expect(storedStatuses.get('listing-1|Cancelled|2025-04-09')).toEqual({
      firstSeenOn: '2025-06-10',
      lastSeenOn: '2025-06-10',
    });
  });

  it('does not let an older snapshot overwrite the listing, but moves firstSeenOn earlier', async () => {
    await syncListing(snapshot('2025-06-10'));

    await expect(syncListing(snapshot('2025-03-29', { upsetAmount: '$9.00' }))).resolves.toEqual({
      listing: 'unchanged',
      statusInserted: 0,
      statusExtended: 1,
    });
    expect(storedStatuses.get('listing-1|Scheduled|2023-07-20')).toEqual({
      firstSeenOn: '2025-03-29',
      lastSeenOn: '2025-06-10',
    });
  });

  it('writes nothing when the same snapshot is synced twice', async () => {
    await syncListing(snapshot('2025-03-01'));

    await expect(syncListing(snapshot('2025-03-01'))).resolves.toEqual({
      listing: 'unchanged',
      statusInserted: 0,
      statusExtended: 0,
    });
  });

  it('skips the status merge when the snapshot has no status rows', async () => {
    await expect(syncListing(snapshot('2025-03-01', { rows: [] }))).resolves.toEqual({
      listing: 'inserted',
      statusInserted: 0,
      statusExtended: 0,
    });
    expect(statusInsert).not.toHaveBeenCalled();
  });

  it('rejects and stores nothing when the status merge fails', async () => {
    statusInsert.mockRejectedValueOnce(new Error('deadlock detected'));

    await expect(syncListing(snapshot('2025-03-01'))).rejects.toThrow('deadlock detected');

    expect(storedListings.size).toBe(0);
    expect(storedStatuses.size).toBe(0);
  });

  it('rejects a snapshot without a sheriff number without opening a transaction', async () => {
    await expect(syncListing(snapshot('2025-03-01', { sheriffId: ' \r ' }))).rejects.toThrow(
      'Listing propertyId 1319120858 in Gloucester County has no sheriff number',
    );

    expect(transaction).not.toHaveBeenCalled();
  });
});
