import { db, listings, statusHistories } from '@sheriff-sale/database';
import { NewJerseySheriffSaleHttpClient, newJerseySheriffSaleService } from '../services/newJerseySheriffSale';
import { ListingParse } from '../types';
import {
  LISTING_CONCURRENCY,
  ScrapedListing,
  newJerseySheriffSaleCountyParser,
  saveListing,
} from './newJerseySheriffSaleScraper';

jest.mock('@sheriff-sale/database', () => ({
  db: { transaction: jest.fn() },
  listings: { id: 'Listing.id', propertyId: 'Listing.propertyId' },
  statusHistories: {},
}));

jest.mock('../services/newJerseySheriffSale', () => ({
  NewJerseySheriffSaleHttpClient: jest.fn(),
  newJerseySheriffSaleService: {
    cleanAddress: jest.fn(),
    getCountyListingsHtml: jest.fn(),
    getListingDetailsHtml: jest.fn(),
    parseCountyProperyIds: jest.fn(),
    parseListingDetails: jest.fn(),
    parseStatusHistory: jest.fn(),
  },
}));

const service = jest.mocked(newJerseySheriffSaleService);
const transaction = jest.mocked(db).transaction as unknown as jest.Mock;

type Write = { table: 'Listing' | 'StatusHistory'; values: unknown };

// A fake transaction: writes are buffered and only land in `committed` when the callback resolves.
// Like the unique index, a listing insert conflicts when its propertyId is stored or claimed by an open transaction.
let committed: Write[];
let storedPropertyIds: Set<number | null>;
let claimedPropertyIds: Set<number | null>;
const listingInsert = jest.fn();
const historyInsert = jest.fn();

const fakeTransaction = async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
  const pending: Write[] = [];
  const claimed: (number | null)[] = [];

  const tx = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        if (table === statusHistories) {
          return historyInsert(values).then(() => {
            pending.push({ table: 'StatusHistory', values });
          });
        }

        if (table !== listings) {
          throw new Error('unexpected table');
        }

        return {
          onConflictDoNothing: (config: unknown) => ({
            returning: async (columns: unknown) => {
              await listingInsert(values, config, columns);
              const { propertyId } = values as ListingParse;

              if (storedPropertyIds.has(propertyId) || claimedPropertyIds.has(propertyId)) {
                return [];
              }

              claimedPropertyIds.add(propertyId);
              claimed.push(propertyId);
              pending.push({ table: 'Listing', values });

              return [{ id: `listing-${propertyId}` }];
            },
          }),
        };
      },
    }),
  };

  try {
    const result = await callback(tx);
    committed.push(...pending);
    claimed.forEach((propertyId) => storedPropertyIds.add(propertyId));

    return result;
  } finally {
    claimed.forEach((propertyId) => claimedPropertyIds.delete(propertyId));
  }
};

const range = (start: number, count: number) => Array.from({ length: count }, (_, i) => start + i);

const scraped = (propertyId: number, statusHistory: ScrapedListing['statusHistory'] = []): ScrapedListing => ({
  listing: { propertyId, address: '1 MAIN STREET' } as ListingParse,
  statusHistory,
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);

  service.cleanAddress.mockReturnValue({} as ReturnType<typeof service.cleanAddress>);
  service.getCountyListingsHtml.mockResolvedValue('county-html');
  service.getListingDetailsHtml.mockImplementation(async (_client, { propertyId }) => `listing-${propertyId}`);
  service.parseListingDetails.mockReturnValue({ address: '1 MAIN STREET' } as ListingParse);
  service.parseStatusHistory.mockReturnValue([{ status: 'Scheduled', date: '1/1/2026' }]);

  committed = [];
  storedPropertyIds = new Set();
  claimedPropertyIds = new Set();
  listingInsert.mockResolvedValue(undefined);
  historyInsert.mockResolvedValue(undefined);
  transaction.mockImplementation(fakeTransaction);
});

describe('saveListing', () => {
  it('inserts the listing and all its status histories in one statement inside the transaction', async () => {
    const statusHistory = [
      { status: 'Scheduled', date: '1/1/2026' },
      { status: 'Adjourned', date: '2/1/2026' },
    ];

    await expect(saveListing(scraped(2195502430, statusHistory))).resolves.toBe(true);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(listingInsert).toHaveBeenCalledWith(
      { propertyId: 2195502430, address: '1 MAIN STREET' },
      { target: listings.propertyId },
      { id: listings.id },
    );
    expect(historyInsert).toHaveBeenCalledTimes(1);
    expect(committed).toEqual([
      { table: 'Listing', values: { propertyId: 2195502430, address: '1 MAIN STREET' } },
      {
        table: 'StatusHistory',
        values: [
          { status: 'Scheduled', date: '1/1/2026', listingId: 'listing-2195502430' },
          { status: 'Adjourned', date: '2/1/2026', listingId: 'listing-2195502430' },
        ],
      },
    ]);
  });

  it('returns false and writes no status history when the propertyId is already stored', async () => {
    storedPropertyIds.add(2195453969);

    await expect(saveListing(scraped(2195453969, [{ status: 'Scheduled', date: '1/1/2026' }]))).resolves.toBe(false);

    expect(historyInsert).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
  });

  it('skips the status-history insert when the listing has none', async () => {
    await expect(saveListing(scraped(1))).resolves.toBe(true);

    expect(historyInsert).not.toHaveBeenCalled();
    expect(committed).toEqual([{ table: 'Listing', values: { propertyId: 1, address: '1 MAIN STREET' } }]);
  });

  it('rejects and stores nothing when the status-history insert fails', async () => {
    historyInsert.mockRejectedValueOnce(new Error('value too long'));

    await expect(saveListing(scraped(1, [{ status: 'Scheduled', date: '1/1/2026' }]))).rejects.toThrow(
      'value too long',
    );

    expect(committed).toEqual([]);
  });

  it('inserts only one listing when the same propertyId is saved concurrently', async () => {
    const results = await Promise.all([
      saveListing(scraped(1, [{ status: 'Scheduled', date: '1/1/2026' }])),
      saveListing(scraped(1, [{ status: 'Scheduled', date: '1/1/2026' }])),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(committed.filter((write) => write.table === 'Listing')).toHaveLength(1);
    expect(committed.filter((write) => write.table === 'StatusHistory')).toHaveLength(1);
  });
});

describe('newJerseySheriffSaleCountyParser', () => {
  it('skips a listing that fails to parse and saves the rest', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1, 2, 3]);
    service.parseListingDetails.mockImplementation((html) => {
      if (html === 'listing-2') {
        throw new TypeError("Cannot read properties of undefined (reading 'querySelectorAll')");
      }

      return { address: '1 MAIN STREET' } as ListingParse;
    });

    const summary = await newJerseySheriffSaleCountyParser('Atlantic');

    expect(summary).toEqual({
      county: 'Atlantic',
      found: 3,
      parsed: 2,
      failedListings: 1,
      inserted: 2,
      failedWrites: 0,
    });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      'Failed to parse listing propertyId 2 in Atlantic County',
      expect.any(TypeError),
    );
  });

  it('does not insert listings already in the database', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1, 2]);
    storedPropertyIds.add(1);

    const summary = await newJerseySheriffSaleCountyParser('Bergen');

    expect(summary.inserted).toBe(1);
    expect(summary.failedWrites).toBe(0);
  });

  it('rejects when every listing fails to fetch or parse', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1, 2]);
    service.getListingDetailsHtml.mockRejectedValue(new Error('getaddrinfo EBUSY'));

    await expect(newJerseySheriffSaleCountyParser('Camden')).rejects.toThrow(
      'All 2 listings in Camden County failed to parse.',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects when every database write fails', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1, 2]);
    transaction.mockRejectedValue(new Error('connection refused'));

    await expect(newJerseySheriffSaleCountyParser('Essex')).rejects.toThrow(
      'All 2 listing writes in Essex County failed.',
    );
  });

  it('writes a listing and its status histories in one transaction, failing it when a history insert fails', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1]);
    const historyError = new Error('value too long for type character varying(12)');
    historyInsert.mockRejectedValueOnce(historyError);

    await expect(newJerseySheriffSaleCountyParser('Gloucester')).rejects.toThrow(
      'All 1 listing writes in Gloucester County failed.',
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(listingInsert).toHaveBeenCalledTimes(1);
    expect(historyInsert).toHaveBeenCalledTimes(1);
    expect(committed).toEqual([]);
    expect(console.error).toHaveBeenCalledWith(
      'Failed to save listing propertyId 1 in Gloucester County',
      historyError,
    );
  });

  it('resolves when only some database writes fail', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1, 2]);
    transaction.mockRejectedValueOnce(new Error('value too long'));

    const summary = await newJerseySheriffSaleCountyParser('Hudson');

    expect(summary.inserted).toBe(1);
    expect(summary.failedWrites).toBe(1);
  });

  it('resolves with nothing to write when the county has no listings', async () => {
    service.parseCountyProperyIds.mockResolvedValue([]);

    const summary = await newJerseySheriffSaleCountyParser('Salem');

    expect(summary).toEqual({
      county: 'Salem',
      found: 0,
      parsed: 0,
      failedListings: 0,
      inserted: 0,
      failedWrites: 0,
    });
    expect(service.getListingDetailsHtml).not.toHaveBeenCalled();
  });

  it('rejects when the county listings page cannot be fetched', async () => {
    service.getCountyListingsHtml.mockRejectedValueOnce(new Error('Request failed with status code 503'));

    await expect(newJerseySheriffSaleCountyParser('Union')).rejects.toThrow('503');
  });

  it('caps in-flight listing fetches across counties running in parallel', async () => {
    let active = 0;
    let maxActive = 0;

    service.parseCountyProperyIds.mockResolvedValueOnce(range(1, 20)).mockResolvedValueOnce(range(101, 20));
    service.getListingDetailsHtml.mockImplementation(async (_client, { propertyId }) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;

      return `listing-${propertyId}`;
    });

    const [morris, passaic] = await Promise.all([
      newJerseySheriffSaleCountyParser('Morris'),
      newJerseySheriffSaleCountyParser('Passaic'),
    ]);

    expect(maxActive).toBe(LISTING_CONCURRENCY);
    expect(service.getListingDetailsHtml).toHaveBeenCalledTimes(40);
    expect(morris.parsed + passaic.parsed).toBe(40);
  });

  it('gives each county its own client and fetches its details with that client', async () => {
    service.parseCountyProperyIds.mockResolvedValueOnce([1, 2]).mockResolvedValueOnce([101, 102]);

    await Promise.all([newJerseySheriffSaleCountyParser('Gloucester'), newJerseySheriffSaleCountyParser('Passaic')]);

    expect(NewJerseySheriffSaleHttpClient).toHaveBeenCalledTimes(2);

    const [gloucesterClient, passaicClient] = service.getCountyListingsHtml.mock.calls.map(([client]) => client);
    const detailsClientsByPropertyId = new Map(
      service.getListingDetailsHtml.mock.calls.map(([client, { propertyId }]) => [propertyId, client]),
    );

    expect(gloucesterClient).not.toBe(passaicClient);
    expect(service.getCountyListingsHtml.mock.calls.map(([, county]) => county)).toEqual(['Gloucester', 'Passaic']);
    expect(detailsClientsByPropertyId.get(1)).toBe(gloucesterClient);
    expect(detailsClientsByPropertyId.get(2)).toBe(gloucesterClient);
    expect(detailsClientsByPropertyId.get(101)).toBe(passaicClient);
    expect(detailsClientsByPropertyId.get(102)).toBe(passaicClient);
  });

  it('does not parse a listing whose session was rejected', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1, 2]);
    service.getListingDetailsHtml.mockImplementation(async (_client, { propertyId }) => {
      if (propertyId === 2) {
        throw new Error('Session rejected for propertyId 2: redirected to /');
      }

      return `listing-${propertyId}`;
    });

    const summary = await newJerseySheriffSaleCountyParser('Passaic');

    expect(summary.failedListings).toBe(1);
    expect(service.parseListingDetails).toHaveBeenCalledTimes(1);
    expect(service.parseListingDetails).toHaveBeenCalledWith('listing-1');
    expect(console.error).toHaveBeenCalledWith(
      'Failed to parse listing propertyId 2 in Passaic County',
      expect.objectContaining({ message: 'Session rejected for propertyId 2: redirected to /' }),
    );
  });
});
