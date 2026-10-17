import { getCountyListingsHtml } from './getCountyListingsHtml';
import { getListingDetailsHtml } from './getListingDetailsHtml';
import { NewJerseySheriffSaleHttpClient } from './newJerseySheriffSaleHttpClient';
import { saveHtmlToS3 } from './saveHtmlToS3';
import { StubRequest, StubResponse, stubClientAdapter } from '../__fixtures__/stubClientAdapter';

jest.mock('./saveHtmlToS3', () => ({ saveHtmlToS3: jest.fn() }));

const mockedSaveHtmlToS3 = jest.mocked(saveHtmlToS3);

/** Plays the site: a county search sets that county's session cookie, and details pages need a session. */
const civilview =
  (sessionIdsByCountyId: Record<string, string>) =>
  ({ url, params, cookie }: StubRequest): StubResponse => {
    if (url === 'Sales/SalesSearch') {
      const sessionId = sessionIdsByCountyId[params?.countyId as string];

      return {
        status: 200,
        data: '<table></table>',
        headers: { 'set-cookie': [`ASP.NET_SessionId=${sessionId}; path=/; HttpOnly; SameSite=Lax`] },
      };
    }

    if (!cookie) {
      return { status: 302, data: '<html>home</html>', headers: { location: '/' } };
    }

    return { status: 200, data: '<div class="sale-detail-item"></div>' };
  };

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockedSaveHtmlToS3.mockReset();
  mockedSaveHtmlToS3.mockResolvedValue(undefined);
});

describe('NewJerseySheriffSaleHttpClient', () => {
  it('sends the session from its county search on every details request', async () => {
    const client = new NewJerseySheriffSaleHttpClient();
    const requests = stubClientAdapter(client, civilview({ '17': 'passaic-session' }));

    await getCountyListingsHtml(client, 'Passaic');
    await getListingDetailsHtml(client, { propertyId: 1 });
    await getListingDetailsHtml(client, { propertyId: 2 });

    expect(requests.map(({ url, params, cookie }) => ({ url, params, cookie }))).toEqual([
      { url: 'Sales/SalesSearch', params: { countyId: '17' }, cookie: undefined },
      { url: '/Sales/SaleDetails', params: { PropertyId: '1' }, cookie: 'ASP.NET_SessionId=passaic-session' },
      { url: '/Sales/SaleDetails', params: { PropertyId: '2' }, cookie: 'ASP.NET_SessionId=passaic-session' },
    ]);
  });

  it('keeps a separate session per client when counties run in parallel', async () => {
    const respond = civilview({ '17': 'passaic-session', '19': 'gloucester-session' });
    const passaicClient = new NewJerseySheriffSaleHttpClient();
    const gloucesterClient = new NewJerseySheriffSaleHttpClient();
    const passaicRequests = stubClientAdapter(passaicClient, respond);
    const gloucesterRequests = stubClientAdapter(gloucesterClient, respond);

    await Promise.all([
      getCountyListingsHtml(passaicClient, 'Passaic'),
      getCountyListingsHtml(gloucesterClient, 'Gloucester'),
    ]);
    await Promise.all([
      getListingDetailsHtml(passaicClient, { propertyId: 1 }),
      getListingDetailsHtml(gloucesterClient, { propertyId: 101 }),
      getListingDetailsHtml(passaicClient, { propertyId: 2 }),
    ]);

    expect(passaicClient.aspSessionId).toBe('passaic-session');
    expect(gloucesterClient.aspSessionId).toBe('gloucester-session');
    expect(passaicRequests.slice(1).map(({ cookie }) => cookie)).toEqual([
      'ASP.NET_SessionId=passaic-session',
      'ASP.NET_SessionId=passaic-session',
    ]);
    expect(gloucesterRequests.slice(1).map(({ cookie }) => cookie)).toEqual(['ASP.NET_SessionId=gloucester-session']);
  });

  it('rejects a details request made without a session instead of following the redirect', async () => {
    const client = new NewJerseySheriffSaleHttpClient();
    const requests = stubClientAdapter(client, civilview({}));

    await expect(getListingDetailsHtml(client, { propertyId: 7 })).rejects.toThrow(
      'Session rejected for propertyId 7: redirected to /',
    );
    expect(requests).toHaveLength(1);
    expect(mockedSaveHtmlToS3).not.toHaveBeenCalled();
  });

  it('archives a county page under a slug of the county name', async () => {
    const client = new NewJerseySheriffSaleHttpClient();
    stubClientAdapter(client, () => ({ status: 200, data: '<table>&amp;</table>' }));

    await expect(getCountyListingsHtml(client, 'Cape May')).resolves.toBe('<table>&amp;</table>');
    expect(mockedSaveHtmlToS3).toHaveBeenCalledWith({
      html: '<table>&amp;</table>',
      keyPrefix: 'county-html-files',
      keySuffix: 'cape-may-county.html',
    });
  });
});
