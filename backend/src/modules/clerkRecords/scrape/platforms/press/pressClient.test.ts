import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { FixtureCounty, readPressFixture } from '../../../__fixtures__/readFixture';
import { HostLimiter } from '../../hostLimiter';
import { ResultPage } from '../../saveResultPageToS3';
import { ClerkParseError } from '../../types';
import { PRESS_COUNTIES, PressCountyConfig } from './counties';
import { MAX_RESULT_PAGES, PressClient, splitDateRange } from './pressClient';

type SeenRequest = { method: string; url?: string; cookie?: string; form: URLSearchParams };
type Reply = { status?: number; html: string; cookie?: string };

/** Plays a PRESS portal: GETs return the entry page with a session cookie, POSTs go to `onPost`. */
const stubPortal = (county: FixtureCounty, onPost: (form: URLSearchParams, index: number) => Reply) => {
  const requests: SeenRequest[] = [];
  const http = axios.create();
  let posts = 0;

  http.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const cookie = config.headers.get('Cookie');
    const form = new URLSearchParams(typeof config.data === 'string' ? config.data : '');
    const method = (config.method ?? 'get').toUpperCase();
    requests.push({ method, url: config.url, cookie: typeof cookie === 'string' ? cookie : undefined, form });

    const reply: Reply =
      method === 'GET'
        ? { html: readPressFixture(county, 'entry'), cookie: 'ASP.NET_SessionId=abc123; path=/; secure; HttpOnly' }
        : onPost(form, posts++);
    const status = reply.status ?? 200;
    const response = {
      status,
      data: reply.html,
      statusText: '',
      headers: reply.cookie ? { 'set-cookie': [reply.cookie] } : {},
      config,
      request: {},
    };

    if (config.validateStatus && !config.validateStatus(status)) {
      throw new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', config, {}, response);
    }

    return response;
  };

  return { http, requests, posts: () => requests.filter(({ method }) => method === 'POST') };
};

const immediateLimiter: HostLimiter = { host: 'test', run: (request) => request(), blocked: false };

const clientFor = (
  county: FixtureCounty,
  http: ReturnType<typeof stubPortal>['http'],
  overrides: Partial<PressCountyConfig> = {},
) => {
  const archived: ResultPage[] = [];
  const config = {
    ...PRESS_COUNTIES[(county[0].toUpperCase() + county.slice(1)) as 'Essex'],
    ...overrides,
  } as PressCountyConfig;
  const client = new PressClient(config, {
    http,
    limiter: immediateLimiter,
    archive: async (page) => {
      archived.push(page);
    },
  });

  return { client, archived };
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('PressClient name search', () => {
  it('posts Passaic’s older field names with hidDiv=NewSearch and returns grouped documents', async () => {
    const portal = stubPortal('passaic', () => ({ html: readPressFixture('passaic', 'name-lis-pendens') }));
    const { client } = clientFor('passaic', portal.http);

    const result = await client.searchByName({ lastName: 'CABIGAO', firstName: 'CORAZON' });

    const [post] = portal.posts();
    expect(post.form.get('_ctl0:PageContent:txtLastNameTab1')).toBe('CABIGAO');
    expect(post.form.get('_ctl0:PageContent:txtFirstNameTab1')).toBe('CORAZON');
    expect(post.form.get('_ctl0:PageContent:ddlDocTypeTab1')).toBe('');
    expect(post.form.get('_ctl0:PageContent:txtFromTab1')).toBe('');
    expect(post.form.get('_ctl0:PageContent:ddlShowRecTab1')).toBe('100');
    expect(post.form.get('_ctl0:PageContent:ddlTotalRecTab1')).toBe('750');
    expect(post.form.get('_ctl0:PageContent:btnSearchTab1')).toBe('Search');
    expect(post.form.get('hidDiv')).toBe('NewSearch');
    expect(post.form.get('hidCurrTab')).toBe('1');
    expect(post.form.get('__VIEWSTATE')).toBeTruthy();
    expect(post.form.get('__EVENTVALIDATION')).toBeTruthy();

    expect(result).toMatchObject({ kind: 'documents', truncated: false, unmappedDocTypes: [] });
    expect(result.kind === 'documents' && result.documents).toEqual([
      expect.objectContaining({
        county: 'Passaic',
        instrumentNumber: '2025037241',
        docCategory: 'LIS_PENDENS',
        recordedDate: '2025-11-05',
        municipality: 'CLIFTON CITY',
        block: null,
        parties: [
          { side: 'direct', name: 'CABIGAO ANGELES' },
          { side: 'direct', name: 'CABIGAO CORAZON' },
          { side: 'direct', name: 'NEW JERSEY STATE OF' },
          { side: 'direct', name: 'UNITED STATES OF AMERICA' },
          { side: 'indirect', name: 'RRA CP OPPORTUNITY TRUST 2' },
        ],
      }),
    ]);
  });

  it('sends Monmouth’s session cookie from the entry GET on the search POST', async () => {
    const portal = stubPortal('monmouth', () => ({ html: readPressFixture('monmouth', 'name-all-types') }));
    const { client } = clientFor('monmouth', portal.http);

    await client.searchByName({ lastName: 'HUBBARD', firstName: 'NICHOLAS' });

    expect(portal.requests.map(({ method }) => method)).toEqual(['GET', 'POST']);
    expect(portal.posts()[0].cookie).toBe('ASP.NET_SessionId=abc123');
    expect(portal.posts()[0].form.get('ctl00$ContentPlaceHolder1$txtLastNameTab1')).toBe('HUBBARD');
    expect(portal.posts()[0].form.has('hidDiv')).toBe(false);
  });

  it('runs one search per dropdown value of the requested categories', async () => {
    const portal = stubPortal('essex', () => ({ html: readPressFixture('essex', 'no-records') }));
    const { client } = clientFor('essex', portal.http);

    await client.searchByName({ lastName: 'HAMILTON', docCategories: ['LIS_PENDENS'] });

    expect(portal.posts().map(({ form }) => form.get('ctl00$ContentPlaceHolder1$ddlDocTypeTab1'))).toEqual([
      '23',
      '25',
      '21',
      '24',
    ]);
  });

  it('splits a two-year Monmouth range into 9 windows of at most 90 days, oldest first', async () => {
    const portal = stubPortal('monmouth', () => ({ html: readPressFixture('monmouth', 'name-all-types') }));
    const { client } = clientFor('monmouth', portal.http);

    const result = await client.searchByName({ lastName: 'HUBBARD', from: '2025-01-01', to: '2026-12-31' });

    const windows = portal
      .posts()
      .map(({ form }) => [
        form.get('ctl00$ContentPlaceHolder1$txtFromTab1'),
        form.get('ctl00$ContentPlaceHolder1$txtToTab1'),
      ]);
    expect(windows).toHaveLength(9);
    expect(windows[0]).toEqual(['01/01/2025', '03/31/2025']);
    expect(windows[8]).toEqual(['12/22/2026', '12/31/2026']);
    // Every window returned the same page; the documents are deduplicated.
    expect(result.kind === 'documents' && new Set(result.documents.map((d) => d.instrumentNumber)).size).toBe(
      result.kind === 'documents' && result.documents.length,
    );
  });

  it('sends one search for a county without a window limit', async () => {
    const portal = stubPortal('essex', () => ({ html: readPressFixture('essex', 'no-records') }));
    const { client } = clientFor('essex', portal.http, { maxWindowDays: null });

    await client.searchByName({ lastName: 'HAMILTON', from: '2023-10-18', to: '2026-10-18' });

    expect(portal.posts()).toHaveLength(1);
  });

  it('returns an empty list for the no-records answer', async () => {
    const portal = stubPortal('burlington', () => ({ html: readPressFixture('burlington', 'no-records') }));
    const { client } = clientFor('burlington', portal.http);

    await expect(client.searchByName({ lastName: 'ZZQXJVWK' })).resolves.toEqual({
      kind: 'documents',
      documents: [],
      unmappedDocTypes: [],
      truncated: false,
    });
  });

  it('fails on an unexpected page', async () => {
    const portal = stubPortal('passaic', () => ({ html: readPressFixture('passaic', 'date-range-error') }));
    const { client } = clientFor('passaic', portal.http);

    await expect(client.searchByName({ lastName: 'CABIGAO' })).rejects.toBeInstanceOf(ClerkParseError);
  });

  it('archives every page before parsing it, numbered per listing and step', async () => {
    const portal = stubPortal('passaic', () => ({ html: readPressFixture('passaic', 'date-range-error') }));
    const { client, archived } = clientFor('passaic', portal.http);

    await expect(
      client.searchByName({ lastName: 'CABIGAO', archive: { listingId: 'listing-1', step: 'name' } }),
    ).rejects.toThrow();

    expect(archived.map(({ listingId, step, n }) => `${listingId}-${step}-${n}`)).toEqual(['listing-1-name-1']);
  });
});

describe('PressClient block/lot search and paging', () => {
  it('posts the Block/Lot tab, then pages back with the pager’s event target and page 1’s hidden fields', async () => {
    const page1 = readPressFixture('monmouth', 'parcel');
    const portal = stubPortal('monmouth', (form) => {
      const target = form.get('__EVENTTARGET');

      if (!target) {
        return { html: page1 };
      }

      return {
        html: target.endsWith('$ctl01$ctl01')
          ? readPressFixture('monmouth', 'parcel-page2')
          : readPressFixture('monmouth', 'no-records'),
      };
    });
    const { client, archived } = clientFor('monmouth', portal.http);

    const result = await client.searchByParcel({
      municipality: 'Leonardo',
      block: '446',
      lot: '4',
      archive: { listingId: 'listing-1', step: 'parcel' },
    });

    const [search, page2] = portal.posts();
    expect(search.form.get('ctl00$ContentPlaceHolder1$ddlMunTab4')).toBe('MIDDLETOWN');
    expect(search.form.get('ctl00$ContentPlaceHolder1$txtBlockTab4')).toBe('446');
    expect(search.form.get('ctl00$ContentPlaceHolder1$txtLotTab4')).toBe('4');
    expect(search.form.get('ctl00$ContentPlaceHolder1$ddlShowRecTab4')).toBe('100');
    expect(search.form.get('ctl00$ContentPlaceHolder1$btnSearchTab4')).toBe('Search');
    expect(search.form.get('hidCurrTab')).toBe('4');
    expect(search.form.has('ctl00$ContentPlaceHolder1$txtQualifierTab4')).toBe(false);

    expect(page2.form.get('__EVENTTARGET')).toBe('ctl00$ContentPlaceHolder1$dgdDeedMort$ctl01$ctl01');
    expect(page2.form.get('__VIEWSTATE')).toBe(/name="__VIEWSTATE"[^>]*value="([^"]*)"/.exec(page1)?.[1]);
    expect(page2.form.has('ctl00$ContentPlaceHolder1$btnSearchTab4')).toBe(false);

    expect(archived.map(({ n }) => n)).toEqual([1, 2, 3]);
    expect(result.kind === 'documents' && result.documents.map((d) => d.instrumentNumber)).toEqual(
      expect.arrayContaining(['1998018047', '2022043490']),
    );
  });

  it('includes Burlington’s qualifier field', async () => {
    const portal = stubPortal('burlington', () => ({ html: readPressFixture('burlington', 'no-records') }));
    const { client } = clientFor('burlington', portal.http);

    await client.searchByParcel({ municipality: 'Hainesport', block: '47.02', lot: '11', qualifier: 'C0201' });

    expect(portal.posts()[0].form.get('ctl00$ContentPlaceHolder1$ddlMunTab4')).toBe('HAINESPORT TWP');
    expect(portal.posts()[0].form.get('ctl00$ContentPlaceHolder1$txtQualifierTab4')).toBe('C0201');
  });

  it('filters a block/lot search to the requested categories', async () => {
    const portal = stubPortal('burlington', () => ({ html: readPressFixture('burlington', 'name-all-types') }));
    const { client } = clientFor('burlington', portal.http);

    const result = await client.searchByParcel({
      municipality: 'HAINESPORT TWP',
      block: '47.02',
      lot: '11',
      docCategories: ['LIS_PENDENS'],
    });

    expect(result.kind === 'documents' && result.documents.map((d) => d.docCategory)).toEqual(['LIS_PENDENS']);
  });

  it('stops after MAX_RESULT_PAGES pages and reports the search truncated', async () => {
    const page1 = readPressFixture('monmouth', 'parcel');
    const portal = stubPortal('monmouth', () => ({ html: page1 }));
    const { client } = clientFor('monmouth', portal.http);

    // Page 1's pager always links page 2, so the portal never runs out of pages.
    const result = await client.searchByParcel({ municipality: 'MIDDLETOWN', block: '446', lot: '4' });

    expect(portal.posts()).toHaveLength(MAX_RESULT_PAGES);
    expect(result).toMatchObject({ kind: 'documents', truncated: true });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('stopped after 5 pages'));
  });

  it('does not send a search for a municipality no alias resolves', async () => {
    const portal = stubPortal('essex', () => ({ html: readPressFixture('essex', 'parcel') }));
    const { client } = clientFor('essex', portal.http);

    await expect(client.searchByParcel({ municipality: 'Atlantis', block: '1', lot: '1' })).resolves.toEqual({
      kind: 'municipality_unresolved',
      municipality: 'Atlantis',
    });
    expect(portal.posts()).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/Essex County: municipality "Atlantis"/));
  });

  it('reports a blocked host', async () => {
    const portal = stubPortal('essex', () => ({ html: '' }));
    const { HostBlockedError } = await import('../../hostLimiter');
    const blockedLimiter: HostLimiter = {
      host: 'press.essexregister.com',
      run: () => Promise.reject(new HostBlockedError('press.essexregister.com')),
      blocked: true,
    };
    const client = new PressClient(PRESS_COUNTIES.Essex as PressCountyConfig, {
      http: portal.http,
      limiter: blockedLimiter,
      archive: async () => undefined,
    });

    await expect(client.searchByName({ lastName: 'HAMILTON' })).resolves.toEqual({ kind: 'blocked' });
    await expect(client.searchByParcel({ municipality: 'LIVINGSTON', block: '1', lot: '1' })).resolves.toEqual({
      kind: 'blocked',
    });
  });
});

describe('PressClient town candidates', () => {
  it('resolves listing cities against the live dropdown once it has loaded', async () => {
    const portal = stubPortal('burlington', () => ({ html: readPressFixture('burlington', 'no-records') }));
    const { client } = clientFor('burlington', portal.http);

    await client.searchByName({ lastName: 'LUNDY' });

    expect(client.townCandidates('Hainesport')).toEqual(['HAINESPORT TWP']);
    expect(client.townCandidates('Browns Mills (pemberton Twp)')).toEqual(['PEMBERTON TWP']);
    expect(client.townCandidates('Mt. Laurel')).toEqual(['MOUNT LAUREL TWP']);
    expect(client.townCandidates('Burlington')).toEqual(['BURLINGTON TWP', 'BURLINGTON CITY']);
    expect(client.townCandidates(null)).toEqual([]);
  });

  it('rescues a Monmouth city with the street in front of it', async () => {
    const portal = stubPortal('monmouth', () => ({ html: readPressFixture('monmouth', 'no-records') }));
    const { client } = clientFor('monmouth', portal.http);

    await client.searchByName({ lastName: 'X' });

    expect(client.townCandidates('55 Tulip Lane Red Bank')).toEqual(['RED BANK']);
    expect(client.townCandidates('Freehold Borough')).toEqual(['FREEHOLD BORO']);
    expect(client.townCandidates('Ocean Township')).toEqual(['OCEAN TOWNSHIP']);
  });

  it('warns at run start about alias targets missing from the live dropdown', async () => {
    const portal = stubPortal('essex', () => ({ html: readPressFixture('essex', 'no-records') }));
    const { client } = clientFor('essex', portal.http, { municipalityAliases: { NOWHERE: ['NOWHERE TWP'] } });

    await client.searchByName({ lastName: 'X' });

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('alias targets missing'));
  });
});

describe('splitDateRange', () => {
  it('keeps a range within the limit whole', () => {
    expect(splitDateRange('2026-01-01', '2026-03-31', 90)).toEqual([{ from: '2026-01-01', to: '2026-03-31' }]);
  });

  it('splits at the limit', () => {
    expect(splitDateRange('2026-01-01', '2026-04-01', 90)).toEqual([
      { from: '2026-01-01', to: '2026-03-31' },
      { from: '2026-04-01', to: '2026-04-01' },
    ]);
  });
});
