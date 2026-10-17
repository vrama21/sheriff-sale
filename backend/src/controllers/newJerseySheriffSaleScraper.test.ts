import { db } from '@sheriff-sale/database';
import { newJerseySheriffSaleService } from '../services/newJerseySheriffSale';
import { ListingParse } from '../types';
import { LISTING_CONCURRENCY, newJerseySheriffSaleCountyParser } from './newJerseySheriffSaleScraper';

jest.mock('@sheriff-sale/database', () => ({
  db: {
    query: { listings: { findFirst: jest.fn() } },
    insert: jest.fn(),
  },
  listings: {},
  statusHistories: {},
}));

jest.mock('../services/newJerseySheriffSale', () => ({
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
const mockedDb = jest.mocked(db);

const findFirst = mockedDb.query.listings.findFirst as unknown as jest.Mock;
const insertValues = jest.fn();

const range = (start: number, count: number) => Array.from({ length: count }, (_, i) => start + i);

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);

  service.cleanAddress.mockReturnValue({} as ReturnType<typeof service.cleanAddress>);
  service.getCountyListingsHtml.mockResolvedValue('county-html');
  service.getListingDetailsHtml.mockImplementation(async ({ propertyId }) => `listing-${propertyId}`);
  service.parseListingDetails.mockReturnValue({ address: '1 MAIN STREET' } as ListingParse);
  service.parseStatusHistory.mockReturnValue([{ status: 'Scheduled', date: '1/1/2026' }]);

  findFirst.mockResolvedValue(undefined);
  insertValues.mockImplementation(async () => [{ id: 'new-id' }]);

  const returning = () => insertValues();
  (mockedDb.insert as unknown as jest.Mock).mockImplementation(() => ({
    values: () => ({ returning, onConflictDoNothing: () => ({ returning }) }),
  }));
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
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      'Failed to parse listing propertyId 2 in Atlantic County',
      expect.any(TypeError),
    );
  });

  it('does not insert listings already in the database', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1, 2]);
    findFirst.mockResolvedValueOnce({ id: 'existing' });

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
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rejects when every database write fails', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1, 2]);
    findFirst.mockRejectedValue(new Error('connection refused'));

    await expect(newJerseySheriffSaleCountyParser('Essex')).rejects.toThrow(
      'All 2 listing writes in Essex County failed.',
    );
  });

  it('resolves when only some database writes fail', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1, 2]);
    findFirst.mockRejectedValueOnce(new Error('value too long'));

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
    service.getListingDetailsHtml.mockImplementation(async ({ propertyId }) => {
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
});
