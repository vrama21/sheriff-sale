import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { recordLookupError, recordUnsupported, saveLookupResult, selectCandidates } from './ingest/lookupState';
import { ListingForLookup } from './match/matchListing';
import { runCountyLookups } from './pipeline';
import { ClerkDocumentRecord, ClerkParseError, ClerkPlatformClient, SearchResult } from './scrape/types';

vi.mock('./ingest/lookupState', () => ({
  MAX_LISTINGS_PER_COUNTY_PER_RUN: 40,
  recordLookupError: vi.fn(),
  recordUnsupported: vi.fn(),
  saveLookupResult: vi.fn(),
  selectCandidates: vi.fn(),
}));

const runStart = DateTime.fromISO('2026-10-18T02:00:00Z', { zone: 'utc' });
// The fixed run start is in the past, so the tests that aren't about the deadline give it none.
const deadlineAt = Number.POSITIVE_INFINITY;

const listings = (count: number): ListingForLookup[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `listing-${index + 1}`,
    county: 'Monmouth',
    defendant: `PERSON${index + 1} SMITH`,
    plaintiff: 'WELLS FARGO BANK',
    courtCase: 'F-000001-26',
    saleDate: '2026-11-01',
    city: 'Freehold',
    parcel: null,
    description: null,
  }));

const lisPendensFor = (lastName: string): ClerkDocumentRecord => ({
  county: 'Monmouth',
  platform: 'press',
  instrumentNumber: `LP-${lastName}`,
  docCategory: 'LIS_PENDENS',
  docTypeRaw: 'FORECLOSURE LISPENDENS',
  recordedDate: '2026-03-01',
  bookType: null,
  book: null,
  page: null,
  municipality: 'FREEHOLD TWP',
  block: null,
  lot: null,
  qualifier: null,
  extraLots: [],
  consideration: null,
  detail: null,
  parties: [
    { side: 'direct', name: `SMITH ${lastName}` },
    { side: 'indirect', name: 'WELLS FARGO BANK' },
  ],
  links: [],
});

/** A client whose name search answers per surname-and-first-name with `respond`. */
const client = (respond: (firstName: string) => Promise<SearchResult>): ClerkPlatformClient => ({
  county: 'Monmouth',
  platform: 'press',
  coverage: { parcelIndex: false, parcelIndexStart: null },
  townCandidates: () => ['FREEHOLD TWP'],
  searchByName: ({ firstName = '' }) => respond(firstName),
  searchByParcel: async () => ({ kind: 'documents', documents: [], unmappedDocTypes: [], truncated: false }),
  searchByInstrument: async () => ({ kind: 'documents', documents: [], unmappedDocTypes: [], truncated: false }),
});

const found = (firstName: string, unmappedDocTypes: string[] = []): Promise<SearchResult> =>
  Promise.resolve({ kind: 'documents', documents: [lisPendensFor(firstName)], unmappedDocTypes, truncated: false });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.mocked(saveLookupResult).mockResolvedValue({ documents: 1, matches: 1, nextCheckAt: null });
});

describe('runCountyLookups', () => {
  it('records one listing’s error and processes the others', async () => {
    vi.mocked(selectCandidates).mockResolvedValue(listings(40));
    const lookups = client((firstName) =>
      firstName === 'PERSON7' ? Promise.reject(new Error('timeout of 30000ms exceeded')) : found(firstName),
    );

    const summary = await runCountyLookups('Monmouth', { runStart, deadlineAt, clientFor: () => lookups });

    expect(summary).toMatchObject({ attempted: 40, matched: 39, errors: 1, blocked: false });
    expect(saveLookupResult).toHaveBeenCalledTimes(39);
    expect(recordLookupError).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'listing-7' }),
      'press',
      expect.any(Error),
      expect.anything(),
    );
    expect(console.error).toHaveBeenCalledWith(
      'Clerk records lookup failed for listing listing-7 in Monmouth County',
      expect.any(Error),
    );
  });

  it('records a failed write as an error by a separate write', async () => {
    vi.mocked(selectCandidates).mockResolvedValue(listings(2));
    vi.mocked(saveLookupResult).mockRejectedValueOnce(new Error('insert failed'));

    const summary = await runCountyLookups('Monmouth', { runStart, deadlineAt, clientFor: () => client(found) });

    expect(summary).toMatchObject({ attempted: 2, matched: 1, errors: 1 });
    expect(recordLookupError).toHaveBeenCalledTimes(1);
  });

  it('fails the county when every lookup failed, counting parse errors', async () => {
    vi.mocked(selectCandidates).mockResolvedValue(listings(3));
    const broken = client(() => Promise.reject(new ClerkParseError('PRESS results page not recognised')));

    await expect(runCountyLookups('Monmouth', { runStart, deadlineAt, clientFor: () => broken })).rejects.toThrow(
      'all 3 lookups failed',
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('errors 3 (parse errors 3)'));
  });

  it('stops a blocked county, leaves its remaining listings due and fails it', async () => {
    vi.mocked(selectCandidates).mockResolvedValue(listings(5));
    const blocking = client((firstName) =>
      firstName === 'PERSON3' ? Promise.resolve({ kind: 'blocked' }) : found(firstName),
    );

    await expect(runCountyLookups('Monmouth', { runStart, deadlineAt, clientFor: () => blocking })).rejects.toThrow(
      'refusing requests',
    );
    expect(saveLookupResult).toHaveBeenCalledTimes(2);
    expect(recordLookupError).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('left for next run 3, host blocked'));
  });

  it('leaves listings due at the run deadline without recording errors', async () => {
    vi.mocked(selectCandidates).mockResolvedValue(listings(4));

    const summary = await runCountyLookups('Monmouth', { runStart, deadlineAt: 0, clientFor: () => client(found) });

    expect(summary).toMatchObject({ attempted: 0, leftForNextRun: 4, errors: 0 });
    expect(saveLookupResult).not.toHaveBeenCalled();
    expect(recordLookupError).not.toHaveBeenCalled();
  });

  it('records an unsupported county’s listings without requesting anything', async () => {
    vi.mocked(selectCandidates).mockResolvedValue(listings(2).map((listing) => ({ ...listing, county: 'Bergen' })));

    const summary = await runCountyLookups('Bergen', { runStart });

    expect(recordUnsupported).toHaveBeenCalledTimes(2);
    expect(summary.attempted).toBe(0);
  });

  it('lists unmapped doc types in the run summary', async () => {
    vi.mocked(selectCandidates).mockResolvedValue(listings(1));

    const summary = await runCountyLookups('Monmouth', {
      runStart,
      deadlineAt,
      clientFor: () => client((firstName) => found(firstName, ['NEW KIND OF NOTICE'])),
    });

    expect(summary.unmappedDocTypes).toEqual(['NEW KIND OF NOTICE']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('unmapped doc types [NEW KIND OF NOTICE]'));
  });
});
