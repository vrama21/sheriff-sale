import { beforeEach, describe, expect, it, vi, type Mock } from 'vite-plus/test';
import { sql } from '@sheriff-sale/database';
import { NJ_COUNTIES, NJCounty } from '../../shared/nj';
import { handler } from './handler';
import { newJerseySheriffSaleCountyParser } from './pipeline';

vi.mock('@sheriff-sale/database', () => ({ sql: vi.fn() }));
vi.mock('./pipeline', () => ({ newJerseySheriffSaleCountyParser: vi.fn() }));

const mockedSql = sql as unknown as Mock;
const countyParser = vi.mocked(newJerseySheriffSaleCountyParser);

const summaryFor = (county: NJCounty) => ({
  county,
  found: 1,
  parsed: 1,
  failedListings: 0,
  inserted: 1,
  updated: 0,
  unchanged: 0,
  failedWrites: 0,
  fieldWarnings: 0,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  mockedSql.mockResolvedValue([{ '?column?': 1 }]);
  countyParser.mockImplementation(async (county) => summaryFor(county));
});

describe('newJerseySheriffSaleScraperHandler', () => {
  it('returns success when every county succeeds', async () => {
    await expect(handler()).resolves.toBe('New Jersey Sheriff Sale Scraper ran successfully.');

    expect(countyParser).toHaveBeenCalledTimes(NJ_COUNTIES.length);
  });

  it('throws naming the failed county while the other counties still run', async () => {
    const cause = new Error('All 3 listings in Camden County failed to parse.');
    countyParser.mockImplementation(async (county) => {
      if (county === 'Camden') {
        throw cause;
      }

      return summaryFor(county);
    });

    await expect(handler()).rejects.toThrow(
      `New Jersey Sheriff Sale Scraper failed for 1/${NJ_COUNTIES.length} counties: Camden.`,
    );

    expect(countyParser).toHaveBeenCalledTimes(NJ_COUNTIES.length);
    expect(console.error).toHaveBeenCalledWith(
      'New Jersey Sheriff Sale Scraper failed to run for county Camden.',
      cause,
    );
  });

  it('throws without scraping when the database health check fails', async () => {
    const cause = new Error('getaddrinfo ENOTFOUND db.example.com');
    mockedSql.mockRejectedValue(cause);

    await expect(handler()).rejects.toThrow('database health check failed');

    expect(console.error).toHaveBeenCalledWith('Database health check failed', cause);
    expect(countyParser).not.toHaveBeenCalled();
  });
});
