import { ListingSnapshot, syncListing } from '../services/listingSync';
import { NewJerseySheriffSaleHttpClient, newJerseySheriffSaleService } from '../services/newJerseySheriffSale';
import { todaysArchiveDate } from '../services/newJerseySheriffSale/saveHtmlToS3';
import {
  LISTING_CONCURRENCY,
  newJerseySheriffSaleCountyParser,
  saveListing,
  scrapeListing,
} from './newJerseySheriffSaleScraper';

// The database client is never loaded: syncListing is mocked and everything else here is pure.
jest.mock('@sheriff-sale/database', () => ({}));
jest.mock('../services/listingSync/syncListing', () => ({ syncListing: jest.fn() }));

jest.mock('../services/newJerseySheriffSale', () => ({
  NewJerseySheriffSaleHttpClient: jest.fn(),
  newJerseySheriffSaleService: {
    getCountyListingsHtml: jest.fn(),
    getListingDetailsHtml: jest.fn(),
    parseCountyProperyIds: jest.fn(),
    parseListingSnapshot: jest.fn(),
  },
}));

jest.mock('../services/newJerseySheriffSale/saveHtmlToS3', () => ({ todaysArchiveDate: jest.fn() }));

const service = jest.mocked(newJerseySheriffSaleService);
const sync = jest.mocked(syncListing);

const range = (start: number, count: number) => Array.from({ length: count }, (_, i) => start + i);

const parsedPage = (sheriffId = 'F-1') => ({
  layout: 'current' as const,
  listing: { sheriffId, address: '1 MAIN STREET\nTRENTON NJ 08608' },
  statusHistory: [{ status: 'Scheduled', date: '1/1/2026' }],
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  jest.mocked(todaysArchiveDate).mockReturnValue('2026-10-18');
  service.getCountyListingsHtml.mockResolvedValue('county-html');
  service.getListingDetailsHtml.mockImplementation(async (_client, { propertyId }) => `listing-${propertyId}`);
  service.parseListingSnapshot.mockImplementation((html) => parsedPage(`F-${html.replace('listing-', '')}`));
  sync.mockResolvedValue({ listing: 'inserted', statusInserted: 1, statusExtended: 0 });
});

describe('scrapeListing', () => {
  it("builds the snapshot for the listing's county and property ID, dated with today's archive date", async () => {
    const { snapshot, warnings } = await scrapeListing({} as NewJerseySheriffSaleHttpClient, 'Atlantic', 2195502430);

    expect(service.parseListingSnapshot).toHaveBeenCalledWith('listing-2195502430');
    expect(snapshot).toMatchObject({
      listing: {
        county: 'Atlantic',
        propertyId: 2195502430,
        sheriffId: 'F-2195502430',
        street: '1 Main Street',
        city: 'Trenton',
        state: 'NJ',
      },
      statusHistory: [{ status: 'Scheduled', date: '2026-01-01' }],
      snapshotDate: '2026-10-18',
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(warnings).toEqual([]);
  });

  it('tags each field warning with the county and property ID', async () => {
    service.parseListingSnapshot.mockReturnValue({
      ...parsedPage(),
      listing: { ...parsedPage().listing, upsetAmount: 'TBD' },
    });

    const { snapshot, warnings } = await scrapeListing({} as NewJerseySheriffSaleHttpClient, 'Bergen', 7);

    expect(snapshot.listing.upsetAmount).toBeNull();
    expect(warnings).toEqual([
      { field: 'upsetAmount', value: 'TBD', reason: 'not a dollar amount', county: 'Bergen', propertyId: 7 },
    ]);
  });

  it('rejects a page without an address', async () => {
    service.parseListingSnapshot.mockReturnValue({ ...parsedPage(), listing: { sheriffId: 'F-1' } });

    await expect(scrapeListing({} as NewJerseySheriffSaleHttpClient, 'Atlantic', 7)).rejects.toThrow(
      'Listing has no address',
    );
  });

  it('rejects a page with no recognised layout', async () => {
    service.parseListingSnapshot.mockReturnValue({ layout: 'unrecognised' });

    await expect(scrapeListing({} as NewJerseySheriffSaleHttpClient, 'Atlantic', 7)).rejects.toThrow(
      'Listing details layout not recognised for propertyId 7',
    );
  });

  it('rejects a page without a sheriff number', async () => {
    service.parseListingSnapshot.mockReturnValue(parsedPage(' \r '));

    await expect(scrapeListing({} as NewJerseySheriffSaleHttpClient, 'Atlantic', 7)).rejects.toThrow(
      'Listing propertyId 7 has no sheriff number',
    );
  });
});

describe('saveListing', () => {
  it('syncs the snapshot through the shared sync and resolves its result', async () => {
    const snapshot = { listing: { county: 'Bergen', sheriffId: 'F-1', propertyId: 1 } } as ListingSnapshot;
    sync.mockResolvedValueOnce({ listing: 'updated', statusInserted: 2, statusExtended: 1 });

    await expect(saveListing(snapshot)).resolves.toEqual({ listing: 'updated', statusInserted: 2, statusExtended: 1 });
    expect(sync).toHaveBeenCalledWith(snapshot);
  });
});

describe('newJerseySheriffSaleCountyParser', () => {
  it('skips a listing that fails to parse and saves the rest', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1, 2, 3]);
    service.parseListingSnapshot.mockImplementation((html) => {
      if (html === 'listing-2') {
        throw new TypeError("Cannot read properties of undefined (reading 'querySelectorAll')");
      }

      return parsedPage();
    });

    const summary = await newJerseySheriffSaleCountyParser('Atlantic');

    expect(summary).toEqual({
      county: 'Atlantic',
      found: 3,
      parsed: 2,
      failedListings: 1,
      inserted: 2,
      updated: 0,
      unchanged: 0,
      failedWrites: 0,
      fieldWarnings: 0,
    });
    expect(sync).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      'Failed to parse listing propertyId 2 in Atlantic County',
      expect.any(TypeError),
    );
  });

  it('counts listings inserted, updated and unchanged', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1, 2, 3, 4]);
    sync
      .mockResolvedValueOnce({ listing: 'inserted', statusInserted: 1, statusExtended: 0 })
      .mockResolvedValueOnce({ listing: 'updated', statusInserted: 0, statusExtended: 1 })
      .mockResolvedValueOnce({ listing: 'unchanged', statusInserted: 0, statusExtended: 1 })
      .mockResolvedValueOnce({ listing: 'unchanged', statusInserted: 0, statusExtended: 0 });

    const summary = await newJerseySheriffSaleCountyParser('Bergen');

    expect(summary).toMatchObject({ inserted: 1, updated: 1, unchanged: 2, failedWrites: 0 });
  });

  it('counts a page with no recognised layout as a failed listing and does not sync it', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1, 2]);
    service.parseListingSnapshot.mockImplementation((html) =>
      html === 'listing-2' ? { layout: 'unrecognised' } : parsedPage(),
    );

    const summary = await newJerseySheriffSaleCountyParser('Burlington');

    expect(summary).toMatchObject({ parsed: 1, failedListings: 1, inserted: 1 });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('rejects when every listing fails to fetch or parse', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1, 2]);
    service.getListingDetailsHtml.mockRejectedValue(new Error('getaddrinfo EBUSY'));

    await expect(newJerseySheriffSaleCountyParser('Camden')).rejects.toThrow(
      'All 2 listings in Camden County failed to parse.',
    );
    expect(sync).not.toHaveBeenCalled();
  });

  it('rejects when every database write fails', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1, 2]);
    sync.mockRejectedValue(new Error('connection refused'));

    await expect(newJerseySheriffSaleCountyParser('Essex')).rejects.toThrow(
      'All 2 listing writes in Essex County failed.',
    );
  });

  it('logs a failed write with its property ID', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1]);
    const syncError = new Error('deadlock detected');
    sync.mockRejectedValueOnce(syncError);

    await expect(newJerseySheriffSaleCountyParser('Gloucester')).rejects.toThrow(
      'All 1 listing writes in Gloucester County failed.',
    );

    expect(console.error).toHaveBeenCalledWith('Failed to save listing propertyId 1 in Gloucester County', syncError);
  });

  it('resolves when only some database writes fail', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1, 2]);
    sync.mockRejectedValueOnce(new Error('value too long'));

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
      updated: 0,
      unchanged: 0,
      failedWrites: 0,
      fieldWarnings: 0,
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

  it('syncs each listing under the county it was scraped for', async () => {
    service.parseCountyProperyIds.mockResolvedValueOnce([1]).mockResolvedValueOnce([101]);

    await Promise.all([newJerseySheriffSaleCountyParser('Gloucester'), newJerseySheriffSaleCountyParser('Passaic')]);

    const countiesByPropertyId = new Map(sync.mock.calls.map(([{ listing }]) => [listing.propertyId, listing.county]));

    expect(countiesByPropertyId).toEqual(
      new Map([
        [1, 'Gloucester'],
        [101, 'Passaic'],
      ]),
    );
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
    expect(service.parseListingSnapshot).toHaveBeenCalledTimes(1);
    expect(service.parseListingSnapshot).toHaveBeenCalledWith('listing-1');
    expect(console.error).toHaveBeenCalledWith(
      'Failed to parse listing propertyId 2 in Passaic County',
      expect.objectContaining({ message: 'Session rejected for propertyId 2: redirected to /' }),
    );
  });

  it('saves a listing with a field coerced to null, and counts and logs the warning', async () => {
    service.parseCountyProperyIds.mockResolvedValue([7]);
    service.parseListingSnapshot.mockReturnValue({
      ...parsedPage(),
      listing: { ...parsedPage().listing, upsetAmount: 'TBD' },
    });

    const summary = await newJerseySheriffSaleCountyParser('Bergen');

    expect(summary).toMatchObject({ inserted: 1, fieldWarnings: 1 });
    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({ listing: expect.objectContaining({ upsetAmount: null }) }),
    );
    expect(console.warn).toHaveBeenCalledWith(
      'Field warning for listing propertyId 7 in Bergen County: upsetAmount "TBD" is not a dollar amount',
    );
  });

  it('syncs the valid status-history rows and warns about the one it skips', async () => {
    service.parseCountyProperyIds.mockResolvedValue([1]);
    service.parseListingSnapshot.mockReturnValue({
      ...parsedPage(),
      statusHistory: [
        { status: 'Scheduled', date: '3/2/2021' },
        { status: 'Adjourned', date: '4/30/3021' },
        { status: 'Sold', date: '5/4/2021' },
      ],
    });

    const summary = await newJerseySheriffSaleCountyParser('Hunterdon');

    expect(summary.fieldWarnings).toBe(1);
    expect(sync.mock.calls[0][0].statusHistory).toEqual([
      { status: 'Scheduled', date: '2021-03-02' },
      { status: 'Sold', date: '2021-05-04' },
    ]);
  });

  it('sums the field warnings of every listing in the county, without failing the run', async () => {
    service.parseCountyProperyIds.mockResolvedValue(range(1, 10));
    service.parseListingSnapshot.mockImplementation((html) => {
      const page = parsedPage(`F-${html}`);

      return ['listing-2', 'listing-5', 'listing-9'].includes(html)
        ? { ...page, listing: { ...page.listing, saleDate: '2/30/2024' } }
        : page;
    });

    const summary = await newJerseySheriffSaleCountyParser('Camden');

    expect(summary).toMatchObject({ found: 10, parsed: 10, inserted: 10, failedWrites: 0, fieldWarnings: 3 });
    expect(console.warn).toHaveBeenCalledTimes(3);
  });
});
