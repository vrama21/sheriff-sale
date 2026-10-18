import { sql } from '@sheriff-sale/database';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vite-plus/test';
import { NJCounty } from '../../shared/nj';
import { handler } from './handler';
import { CountyLookupSummary, runCountyLookups } from './pipeline';

vi.mock('@sheriff-sale/database', () => ({ sql: vi.fn() }));
vi.mock('./pipeline', () => ({
  RUN_DEADLINE_MS: 780_000,
  SUPPORTED_COUNTIES: ['Essex', 'Passaic', 'Monmouth', 'Burlington'],
  runCountyLookups: vi.fn(),
}));

const mockedSql = sql as unknown as Mock;
const countyLookups = vi.mocked(runCountyLookups);

const summaryFor = (county: NJCounty): CountyLookupSummary => ({
  county,
  attempted: 1,
  matched: 1,
  noLisPendens: 0,
  complete: 0,
  errors: 0,
  parseErrors: 0,
  truncatedSearches: 0,
  unmappedDocTypes: [],
  leftForNextRun: 0,
  blocked: false,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  mockedSql.mockResolvedValue([{ '?column?': 1 }]);
  countyLookups.mockImplementation(async (county) => summaryFor(county));
});

describe('clerk records handler', () => {
  it('runs the four PRESS counties with one shared deadline', async () => {
    await expect(handler()).resolves.toBe('New Jersey Clerk Records ran successfully.');

    expect(countyLookups.mock.calls.map(([county]) => county)).toEqual(['Essex', 'Passaic', 'Monmouth', 'Burlington']);
    const deadlines = new Set(countyLookups.mock.calls.map(([, options]) => options?.deadlineAt));
    expect(deadlines.size).toBe(1);
  });

  it('throws naming the failed county while the others still run', async () => {
    countyLookups.mockImplementation(async (county) => {
      if (county === 'Essex') {
        throw new Error('Clerk records Essex County failed: its host is refusing requests');
      }

      return summaryFor(county);
    });

    await expect(handler()).rejects.toThrow('New Jersey Clerk Records failed for 1/4 counties: Essex.');
    expect(countyLookups).toHaveBeenCalledTimes(4);
  });

  it('aborts before any lookup when the database is unreachable', async () => {
    mockedSql.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(handler()).rejects.toThrow('database health check failed');
    expect(countyLookups).not.toHaveBeenCalled();
  });
});
