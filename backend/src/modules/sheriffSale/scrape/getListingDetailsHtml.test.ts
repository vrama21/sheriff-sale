import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { AxiosError } from 'axios';
import { getListingDetailsHtml } from './getListingDetailsHtml';
import { NewJerseySheriffSaleHttpClient } from './newJerseySheriffSaleHttpClient';
import { saveHtmlToS3 } from './saveHtmlToS3';
import { readFixture, StubResponse, stubClientAdapter } from '../__fixtures__/stubClientAdapter';

vi.mock('./saveHtmlToS3', () => ({ saveHtmlToS3: vi.fn() }));

const mockedSaveHtmlToS3 = vi.mocked(saveHtmlToS3);

const createClient = (response: StubResponse) => {
  const client = new NewJerseySheriffSaleHttpClient();
  const requests = stubClientAdapter(client, () => response);

  return { client, requests };
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mockedSaveHtmlToS3.mockReset();
  mockedSaveHtmlToS3.mockResolvedValue(undefined);
});

describe('getListingDetailsHtml', () => {
  it('archives and returns the html as served, without decoding entities', async () => {
    const { client } = createClient({ status: 200, data: '<div>A &lt;b&gt; &amp;amp; C</div>' });

    const html = await getListingDetailsHtml(client, { propertyId: 42 });

    expect(html).toBe('<div>A &lt;b&gt; &amp;amp; C</div>');
    expect(mockedSaveHtmlToS3).toHaveBeenCalledWith({
      html: '<div>A &lt;b&gt; &amp;amp; C</div>',
      keyPrefix: 'listing-html-files',
      keySuffix: 'property-id-42.html',
    });
  });

  it('requests the property without following redirects', async () => {
    const { client, requests } = createClient({ status: 200, data: '<div></div>' });

    await getListingDetailsHtml(client, { propertyId: 42 });

    expect(requests).toEqual([
      expect.objectContaining({ url: '/Sales/SaleDetails', params: { PropertyId: '42' }, maxRedirects: 0 }),
    ]);
  });

  it('rejects with a session error naming the property when the site redirects', async () => {
    const { client } = createClient({ status: 302, data: readFixture('home.html'), headers: { location: '/' } });

    await expect(getListingDetailsHtml(client, { propertyId: 42 })).rejects.toThrow(
      'Session rejected for propertyId 42: redirected to /',
    );
    expect(mockedSaveHtmlToS3).not.toHaveBeenCalled();
  });

  it('rejects with the HTTP error when the request fails', async () => {
    const { client } = createClient({ status: 503, data: 'Service Unavailable' });

    await expect(getListingDetailsHtml(client, { propertyId: 42 })).rejects.toThrow(
      'Request failed with status code 503',
    );
    expect(mockedSaveHtmlToS3).not.toHaveBeenCalled();
  });

  it('rejects with the timeout error when the request hangs past the 30 s timeout', async () => {
    const client = new NewJerseySheriffSaleHttpClient();
    const axiosInstance = client['axiosInstance'];

    // Rejects the way axios's http adapter does when `config.timeout` elapses.
    axiosInstance.defaults.adapter = async (config) => {
      throw new AxiosError(`timeout of ${config.timeout}ms exceeded`, 'ECONNABORTED', config, {});
    };

    await expect(getListingDetailsHtml(client, { propertyId: 42 })).rejects.toMatchObject({
      code: 'ECONNABORTED',
      message: 'timeout of 30000ms exceeded',
    });
    expect(mockedSaveHtmlToS3).not.toHaveBeenCalled();
  });

  it('rejects naming the property when the response body is empty', async () => {
    const { client } = createClient({ status: 200, data: '' });

    await expect(getListingDetailsHtml(client, { propertyId: 42 })).rejects.toThrow(
      'Empty listing details response for propertyId 42',
    );
  });

  it('still returns the html when archiving to S3 fails', async () => {
    const { client } = createClient({ status: 200, data: '<table></table>' });
    mockedSaveHtmlToS3.mockRejectedValue(new Error('getaddrinfo EBUSY'));

    await expect(getListingDetailsHtml(client, { propertyId: 42 })).resolves.toBe('<table></table>');
    expect(console.error).toHaveBeenCalledWith('Failed to save html for propertyId 42 to S3', expect.any(Error));
  });
});
