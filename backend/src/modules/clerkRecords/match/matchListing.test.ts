import axios, { InternalAxiosRequestConfig } from 'axios';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { FixtureCounty, readPressFixture } from '../__fixtures__/readFixture';
import { HostBlockedError } from '../scrape/hostLimiter';
import { PRESS_COUNTIES, PressCountyConfig } from '../scrape/platforms/press/counties';
import { PressClient } from '../scrape/platforms/press/pressClient';
import {
  ClerkDocumentRecord,
  ClerkPlatformClient,
  NameSearchInput,
  ParcelSearchInput,
  SearchResult,
} from '../scrape/types';
import { ListingForLookup, LookupDeadlineError, matchListing } from './matchListing';

const now = DateTime.fromISO('2026-10-18T12:00:00Z', { zone: 'utc' });

const doc = (
  overrides: Partial<ClerkDocumentRecord> & { direct?: string[]; indirect?: string[] },
): ClerkDocumentRecord => {
  const { direct = [], indirect = [], ...rest } = overrides;

  return {
    county: 'Monmouth',
    platform: 'press',
    instrumentNumber: '1',
    docCategory: 'LIS_PENDENS',
    docTypeRaw: 'FORECLOSURE LISPENDENS',
    recordedDate: '2026-03-02',
    bookType: null,
    book: null,
    page: null,
    municipality: 'MARGATE CITY',
    block: null,
    lot: null,
    qualifier: null,
    extraLots: [],
    consideration: null,
    detail: null,
    parties: [
      ...direct.map((name) => ({ side: 'direct' as const, name })),
      ...indirect.map((name) => ({ side: 'indirect' as const, name })),
    ],
    links: [],
    ...rest,
  };
};

const documents = (list: ClerkDocumentRecord[]): SearchResult => ({
  kind: 'documents',
  documents: list,
  unmappedDocTypes: [],
  truncated: false,
});

/** A client whose searches return fixed documents, recording what they were asked. */
const stubClient = ({
  named = [],
  parcel = [],
  parcelIndex = true,
}: {
  named?: ClerkDocumentRecord[];
  parcel?: ClerkDocumentRecord[];
  parcelIndex?: boolean;
}) => {
  const nameSearches: NameSearchInput[] = [];
  const parcelSearches: ParcelSearchInput[] = [];
  const client: ClerkPlatformClient = {
    county: 'Monmouth',
    platform: 'press',
    coverage: { parcelIndex, parcelIndexStart: null },
    townCandidates: (city) => (city === 'Margate' ? ['MARGATE CITY'] : city ? [city.toUpperCase()] : []),
    searchByName: async (input) => {
      nameSearches.push(input);

      return documents(named);
    },
    searchByParcel: async (input) => {
      parcelSearches.push(input);

      return documents(parcel);
    },
    searchByInstrument: async () => documents([]),
  };

  return { client, nameSearches, parcelSearches };
};

const listing = (overrides: Partial<ListingForLookup> = {}): ListingForLookup => ({
  id: 'listing-1',
  county: 'Monmouth',
  defendant: 'John Smith; Jane Smith',
  plaintiff: 'Wells Fargo Bank, N.A.',
  courtCase: 'F-012441-26',
  saleDate: '2026-11-02',
  city: 'Margate',
  parcel: 'Tax Lot 10 Block 522',
  description: null,
  ...overrides,
});

const matchOf = (result: Awaited<ReturnType<typeof matchListing>>, instrumentNumber: string) =>
  result.matches.find((match) => match.instrumentNumber === instrumentNumber);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('lis pendens match', () => {
  it('stores a strong match as FORECLOSED_LIS_PENDENS/high', async () => {
    const { client, nameSearches } = stubClient({
      named: [doc({ instrumentNumber: 'LP1', direct: ['SMITH JOHN'], indirect: ['WELLS FARGO BANK NA'] })],
    });

    const result = await matchListing(client, listing(), { now });

    expect(nameSearches).toEqual([
      { lastName: 'SMITH', firstName: 'JOHN', archive: { listingId: 'listing-1', step: 'name' } },
    ]);
    expect(result.outcome).toBe('matched');
    expect(matchOf(result, 'LP1')).toEqual({
      instrumentNumber: 'LP1',
      role: 'FORECLOSED_LIS_PENDENS',
      matchedBy: 'lis_pendens_party',
      confidence: 'high',
    });
  });

  it('stores a substituted plaintiff with the same town and block/lot as medium', async () => {
    const { client } = stubClient({
      named: [
        doc({ instrumentNumber: 'LP1', direct: ['SMITH JOHN'], indirect: ['OTHER BANK'], block: '522', lot: '10' }),
      ],
    });

    const result = await matchListing(client, listing(), { now });

    expect(matchOf(result, 'LP1')).toMatchObject({ role: 'FORECLOSED_LIS_PENDENS', confidence: 'medium' });
  });

  it('does not store a lis pendens that only names the defendant', async () => {
    const { client } = stubClient({
      named: [
        doc({ instrumentNumber: 'LP1', direct: ['SMITH JOHN'], indirect: ['OTHER BANK'], municipality: 'OCEAN CITY' }),
      ],
    });

    const result = await matchListing(client, listing(), { now });

    expect(result.outcome).toBe('no_lis_pendens');
    expect(result.matches).toEqual([]);
  });

  it('keeps only lis pendens recorded from 1 January of the docket year to the sale', async () => {
    const { client } = stubClient({
      named: [
        doc({
          instrumentNumber: 'OLD',
          recordedDate: '2025-12-31',
          direct: ['SMITH JOHN'],
          indirect: ['WELLS FARGO BANK'],
        }),
        doc({
          instrumentNumber: 'NEW',
          recordedDate: '2026-01-01',
          direct: ['SMITH JOHN'],
          indirect: ['WELLS FARGO BANK'],
        }),
      ],
    });

    const result = await matchListing(client, listing({ courtCase: 'F00258326' }), { now });

    expect(result.matches.map(({ instrumentNumber }) => instrumentNumber)).toEqual(['NEW']);
  });
});

describe('parcel sweep', () => {
  it('stores the deed into the defendant as PRIOR_DEED/high and the assignments as MORTGAGE_ASSIGNMENT', async () => {
    const lisPendens = doc({
      instrumentNumber: 'LP1',
      direct: ['SMITH JOHN'],
      indirect: ['WELLS FARGO BANK'],
      block: '522',
      lot: '10',
    });
    const { client, parcelSearches } = stubClient({
      named: [lisPendens],
      parcel: [
        lisPendens,
        doc({
          instrumentNumber: 'D1',
          docCategory: 'DEED',
          recordedDate: '2019-05-01',
          direct: ['ROE MARY'],
          indirect: ['SMITH JOHN'],
        }),
        doc({
          instrumentNumber: 'A1',
          docCategory: 'MORTGAGE_ASSIGNMENT',
          direct: ['MERS'],
          indirect: ['WELLS FARGO BANK'],
        }),
        doc({
          instrumentNumber: 'A2',
          docCategory: 'MORTGAGE_ASSIGNMENT',
          direct: ['SMITH JOHN'],
          indirect: ['WELLS FARGO BANK'],
        }),
      ],
    });

    const result = await matchListing(client, listing({ parcel: null }), { now });

    expect(parcelSearches).toEqual([
      {
        municipality: 'MARGATE CITY',
        block: '522',
        lot: '10',
        qualifier: undefined,
        archive: { listingId: 'listing-1', step: 'parcel' },
      },
    ]);
    expect(matchOf(result, 'LP1')?.role).toBe('FORECLOSED_LIS_PENDENS');
    expect(matchOf(result, 'D1')).toMatchObject({ role: 'PRIOR_DEED', matchedBy: 'parcel', confidence: 'high' });
    expect(matchOf(result, 'A1')).toMatchObject({ role: 'MORTGAGE_ASSIGNMENT', confidence: 'medium' });
    expect(matchOf(result, 'A2')).toMatchObject({ role: 'MORTGAGE_ASSIGNMENT', confidence: 'high' });
  });

  it('stores a sheriff’s deed recorded after the sale and completes the listing', async () => {
    const { client } = stubClient({
      parcel: [
        doc({
          instrumentNumber: 'M1',
          docCategory: 'MORTGAGE',
          direct: ['SMITH JOHN'],
          indirect: ['WELLS FARGO BANK'],
        }),
        doc({
          instrumentNumber: 'SD1',
          docCategory: 'SHERIFF_DEED',
          recordedDate: '2026-11-20',
          direct: ['SHERIFF OF MONMOUTH COUNTY', 'SMITH JOHN'],
          indirect: ['WELLS FARGO BANK'],
        }),
      ],
    });

    const result = await matchListing(client, listing(), { now: DateTime.fromISO('2026-12-03T00:00:00Z') });

    expect(matchOf(result, 'SD1')).toMatchObject({ role: 'SHERIFF_DEED', matchedBy: 'parcel', confidence: 'high' });
    expect(result.outcome).toBe('complete');
  });

  it('ignores a parcel from the listing text when no document on it names a defendant', async () => {
    const { client } = stubClient({
      parcel: [doc({ instrumentNumber: 'X', docCategory: 'DEED', direct: ['ROE MARY'], indirect: ['DOE RICHARD'] })],
    });

    const result = await matchListing(client, listing(), { now });

    expect(result.matches).toEqual([]);
  });

  it('skips the sweep in a county without a block/lot index', async () => {
    const { client, parcelSearches } = stubClient({ parcelIndex: false });

    await matchListing(client, listing(), { now });

    expect(parcelSearches).toEqual([]);
  });
});

describe('foreclosed mortgage match', () => {
  const lisPendens = doc({
    instrumentNumber: 'LP1',
    recordedDate: '2026-02-01',
    direct: ['SMITH JOHN'],
    indirect: ['WELLS FARGO BANK'],
    block: '522',
    lot: '10',
  });

  it('takes the parcel’s latest mortgage by a defendant before the lis pendens', async () => {
    const { client } = stubClient({
      named: [lisPendens],
      parcel: [
        doc({
          instrumentNumber: 'M2014',
          docCategory: 'MORTGAGE',
          recordedDate: '2014-06-01',
          direct: ['SMITH JOHN'],
          indirect: ['A BANK'],
        }),
        doc({
          instrumentNumber: 'M2021',
          docCategory: 'MORTGAGE',
          recordedDate: '2021-06-01',
          direct: ['SMITH JOHN'],
          indirect: ['B BANK'],
        }),
      ],
    });

    const result = await matchListing(client, listing(), { now });

    expect(matchOf(result, 'M2021')).toMatchObject({
      role: 'FORECLOSED_MORTGAGE',
      matchedBy: 'parcel',
      confidence: 'high',
    });
    expect(matchOf(result, 'M2014')?.role).toBe('RELATED');
  });

  it('stores every plausible name-search mortgage at low confidence when it can’t choose', async () => {
    const lisPendensNoParcel = doc({ ...lisPendens, block: null, lot: null });
    const { client } = stubClient({
      named: [
        lisPendensNoParcel,
        doc({
          instrumentNumber: 'M1',
          docCategory: 'MORTGAGE',
          recordedDate: '2015-01-01',
          direct: ['SMITH JOHN'],
          indirect: ['WELLS FARGO BANK'],
        }),
        doc({
          instrumentNumber: 'M2',
          docCategory: 'MORTGAGE',
          recordedDate: '2019-01-01',
          direct: ['SMITH JOHN'],
          indirect: ['WELLS FARGO BANK NA'],
        }),
        doc({
          instrumentNumber: 'M3',
          docCategory: 'MORTGAGE',
          recordedDate: '2018-01-01',
          direct: ['SMITH JOHN'],
          indirect: ['QUICKEN LOANS'],
        }),
      ],
    });

    const result = await matchListing(client, listing({ parcel: null }), { now });

    expect(matchOf(result, 'M1')).toMatchObject({
      role: 'FORECLOSED_MORTGAGE',
      matchedBy: 'mortgage_party',
      confidence: 'low',
    });
    expect(matchOf(result, 'M2')).toMatchObject({ role: 'FORECLOSED_MORTGAGE', confidence: 'low' });
    expect(matchOf(result, 'M3')).toBeUndefined();
  });

  it('picks the name-search mortgage assigned to the plaintiff at medium, with its later assignments', async () => {
    const { client } = stubClient({
      parcelIndex: false,
      named: [
        doc({ ...lisPendens, indirect: ['RRA CP OPPORTUNITY TRUST 2'] }),
        doc({
          instrumentNumber: 'M1',
          docCategory: 'MORTGAGE',
          recordedDate: '2005-05-02',
          direct: ['SMITH JOHN'],
          indirect: ['GMAC MORTGAGE CORP'],
        }),
        doc({
          instrumentNumber: 'M0',
          docCategory: 'MORTGAGE',
          recordedDate: '2003-01-01',
          direct: ['SMITH JOHN'],
          indirect: ['CITIMORTGAGE INC'],
        }),
        doc({
          instrumentNumber: 'AS1',
          docCategory: 'MORTGAGE_ASSIGNMENT',
          recordedDate: '2019-01-01',
          direct: ['SMITH JOHN', 'GMAC MORTGAGE CORP'],
          indirect: ['RRA CP OPPORTUNITY TRUST 2'],
        }),
      ],
    });

    const result = await matchListing(client, listing({ plaintiff: 'RRA CP Opportunity Trust 2' }), { now });

    expect(matchOf(result, 'M1')).toMatchObject({
      role: 'FORECLOSED_MORTGAGE',
      matchedBy: 'mortgage_party',
      confidence: 'medium',
    });
    expect(matchOf(result, 'M0')).toBeUndefined();
    expect(matchOf(result, 'AS1')).toMatchObject({
      role: 'MORTGAGE_ASSIGNMENT',
      matchedBy: 'mortgage_party',
      confidence: 'medium',
    });
  });
});

describe('lookup control', () => {
  it('throws HostBlockedError when the host is blocked', async () => {
    const { client } = stubClient({});
    client.searchByName = async () => ({ kind: 'blocked' });

    await expect(matchListing(client, listing(), { now })).rejects.toBeInstanceOf(HostBlockedError);
  });

  it('stops at the run deadline', async () => {
    const { client, nameSearches } = stubClient({});

    await expect(matchListing(client, listing(), { now, pastDeadline: () => true })).rejects.toBeInstanceOf(
      LookupDeadlineError,
    );
    expect(nameSearches).toEqual([]);
  });

  it('reports a listing with no searchable defendant as no lis pendens without searching', async () => {
    const { client, nameSearches } = stubClient({});

    await expect(matchListing(client, listing({ defendant: 'SPOUSE OF JOHN DOE' }), { now })).resolves.toMatchObject({
      outcome: 'no_lis_pendens',
    });
    expect(nameSearches).toEqual([]);
  });
});

/** The real PRESS client against the spike's pages: name search → `nameFixture`, block/lot → the parcel fixtures. */
const fixtureClient = (county: FixtureCounty, nameFixture: string) => {
  const http = axios.create();
  const posts: URLSearchParams[] = [];

  http.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const form = new URLSearchParams(typeof config.data === 'string' ? config.data : '');
    let html = readPressFixture(county, 'entry');

    if (config.method?.toUpperCase() === 'POST') {
      posts.push(form);
      const target = form.get('__EVENTTARGET');

      if (target) {
        html = target.endsWith('$ctl01$ctl01')
          ? readPressFixture(county, 'parcel-page2')
          : readPressFixture(county, 'no-records');
      } else if ([...form.keys()].some((key) => key.endsWith('btnSearchTab4'))) {
        html = readPressFixture(county, 'parcel');
      } else {
        html = readPressFixture(county, nameFixture);
      }
    }

    return { status: 200, data: html, statusText: '', headers: {}, config, request: {} };
  };

  const config = PRESS_COUNTIES[(county[0].toUpperCase() + county.slice(1)) as 'Essex'] as PressCountyConfig;
  const client = new PressClient(config, {
    http,
    limiter: { host: county, run: (request) => request(), blocked: false },
    archive: async () => undefined,
  });

  return { client, posts };
};

describe('matching the spike’s listings', () => {
  it('Monmouth: a plaintiff substituted after assignment, the mortgage by its mortgagee, and the parcel’s older documents', async () => {
    const { client } = fixtureClient('monmouth', 'name-all-types');

    const result = await matchListing(
      client,
      listing({
        county: 'Monmouth',
        defendant: 'Nicholas Hubbard Jr. et al.',
        plaintiff: 'Lakeview Loan Servicing, LLC',
        courtCase: 'F00463123',
        saleDate: '2026-10-26',
        city: 'Leonardo',
        parcel: 'Lot 4, Block 446 on the official Tax Map of the Township of Middletown',
      }),
      { now },
    );

    expect(result.outcome).toBe('matched');
    expect(matchOf(result, '2023027660')).toMatchObject({ role: 'FORECLOSED_LIS_PENDENS', confidence: 'medium' });
    // The spike captured parcel pages 1 and 2 only, and the 2022 mortgage is on a later page, so it comes from the
    // name search: its mortgagee is the lis pendens's plaintiff.
    expect(matchOf(result, '2022057426')).toMatchObject({
      role: 'FORECLOSED_MORTGAGE',
      matchedBy: 'mortgage_party',
      confidence: 'medium',
    });
    expect(matchOf(result, '2023037019')).toMatchObject({ role: 'MORTGAGE_ASSIGNMENT', matchedBy: 'mortgage_party' });
    // Pages 1 and 2 hold the parcel's older documents, before the defendant owned it.
    expect(matchOf(result, '1998018047')).toMatchObject({ role: 'RELATED', matchedBy: 'parcel', confidence: 'medium' });
  });

  it('Burlington: a strong lis pendens whose block/lot drives the sweep', async () => {
    const { client, posts } = fixtureClient('burlington', 'name-all-types');

    const result = await matchListing(
      client,
      listing({
        county: 'Burlington',
        defendant: 'NAJEE LUNDY AND SPOUSE OF NAJEE LUNDY',
        plaintiff: 'AMERICAN NEIGHBORHOOD MORTGAGE ACCEPTANCE COMPANY, LLC',
        courtCase: 'F-007795-24',
        saleDate: '2026-10-22',
        city: 'Hainesport',
        parcel: null,
      }),
      { now },
    );

    const sweep = posts.find((form) => form.has('ctl00$ContentPlaceHolder1$btnSearchTab4'));
    expect(sweep?.get('ctl00$ContentPlaceHolder1$ddlMunTab4')).toBe('HAINESPORT TWP');
    expect(sweep?.get('ctl00$ContentPlaceHolder1$txtBlockTab4')).toBe('47.02');
    expect(matchOf(result, '5908403')).toMatchObject({ role: 'FORECLOSED_LIS_PENDENS', confidence: 'high' });
    expect(matchOf(result, '5872279')).toMatchObject({ role: 'FORECLOSED_MORTGAGE', matchedBy: 'parcel' });
    expect(matchOf(result, '5872278')).toMatchObject({ role: 'PRIOR_DEED', confidence: 'high' });
  });

  it('Passaic: the mortgages assigned toward the plaintiff, not the ones MERS held for other lenders', async () => {
    const { client } = fixtureClient('passaic', 'name-all-types');

    const result = await matchListing(
      client,
      listing({
        county: 'Passaic',
        defendant: 'CORAZON CABIGAO, ET ALS.',
        plaintiff: 'RRA CP OPPORTUNITY TRUST 2',
        courtCase: 'F 012110 25 CTL # 163224',
        saleDate: '2026-10-20',
        city: 'Clifton',
        parcel: 'Tax Lot 24 Block 27.07',
      }),
      { now },
    );
    const byRole = (role: string) =>
      result.matches
        .filter((match) => match.role === role)
        .map(({ instrumentNumber, confidence }) => `${instrumentNumber}/${confidence}`)
        .sort();

    expect(byRole('FORECLOSED_LIS_PENDENS')).toEqual(['2025037241/high']);
    // Two GMAC mortgages trace to the plaintiff through GMAC's 2025 assignment; neither can be told apart, so both low.
    expect(byRole('FORECLOSED_MORTGAGE')).toEqual(['2005042149/low', '2007016034/low']);
    // Castle Point's loans, and their assignment to CitiFinancial, belong to another lender.
    expect(byRole('MORTGAGE_ASSIGNMENT')).not.toContain('2005096989/medium');
  });

  it('Passaic: a strong lis pendens and no parcel sweep', async () => {
    const { client, posts } = fixtureClient('passaic', 'name-lis-pendens');

    const result = await matchListing(
      client,
      listing({
        county: 'Passaic',
        defendant: 'CORAZON CABIGAO, ET ALS.',
        plaintiff: 'RRA CP OPPORTUNITY TRUST 2',
        courtCase: 'F 012110 25 CTL # 163224',
        saleDate: '2026-10-20',
        city: 'Clifton',
        parcel: 'Tax Lot 24 Block 27.07',
      }),
      { now },
    );

    expect(posts).toHaveLength(1);
    expect(result.matches).toEqual([
      {
        instrumentNumber: '2025037241',
        role: 'FORECLOSED_LIS_PENDENS',
        matchedBy: 'lis_pendens_party',
        confidence: 'high',
      },
    ]);
  });
});
