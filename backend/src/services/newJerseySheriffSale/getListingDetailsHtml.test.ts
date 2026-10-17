import { AxiosError } from 'axios';
import { getListingDetailsHtml } from './getListingDetailsHtml';
import { NewJerseySheriffSaleHttpClient } from './newJerseySheriffSaleHttpClient';
import { saveHtmlToS3 } from './saveHtmlToS3';

jest.mock('./saveHtmlToS3', () => ({ saveHtmlToS3: jest.fn() }));

const mockedSaveHtmlToS3 = jest.mocked(saveHtmlToS3);

/** A client whose requests never leave the process: `respond` plays the server. */
const createClient = (respond: (status: number) => { status: number; data: unknown }, status = 200) => {
  const client = new NewJerseySheriffSaleHttpClient();
  const axiosInstance = (client as unknown as { axiosInstance: { defaults: { adapter: unknown } } }).axiosInstance;

  axiosInstance.defaults.adapter = async (config: never) => {
    const response = { ...respond(status), statusText: '', headers: {}, config, request: {} };

    if (response.status >= 400) {
      throw new AxiosError(
        `Request failed with status code ${response.status}`,
        'ERR_BAD_RESPONSE',
        config,
        {},
        response,
      );
    }

    return response;
  };

  jest.spyOn(NewJerseySheriffSaleHttpClient, 'getClient').mockReturnValue(client);
};

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockedSaveHtmlToS3.mockReset();
  mockedSaveHtmlToS3.mockResolvedValue(undefined);
});

describe('getListingDetailsHtml', () => {
  it('decodes the html once, archives it, and returns the same html', async () => {
    createClient((status) => ({ status, data: '<table>&amp;amp;</table>' }));

    const html = await getListingDetailsHtml({ propertyId: 42 });

    expect(html).toBe('<table>&amp;</table>');
    expect(mockedSaveHtmlToS3).toHaveBeenCalledWith({
      html,
      keyPrefix: 'listing-html-files',
      keySuffix: 'property-id-42.html',
    });
  });

  it('rejects with the HTTP error when the request fails', async () => {
    createClient((status) => ({ status, data: 'Service Unavailable' }), 503);

    await expect(getListingDetailsHtml({ propertyId: 42 })).rejects.toThrow('Request failed with status code 503');
    expect(mockedSaveHtmlToS3).not.toHaveBeenCalled();
  });

  it('rejects with the timeout error when the request hangs past the 30 s timeout', async () => {
    const client = new NewJerseySheriffSaleHttpClient();
    const axiosInstance = (client as unknown as { axiosInstance: { defaults: { adapter: unknown } } }).axiosInstance;

    // Rejects the way axios's http adapter does when `config.timeout` elapses.
    axiosInstance.defaults.adapter = async (config: { timeout?: number }) => {
      throw new AxiosError(`timeout of ${config.timeout}ms exceeded`, 'ECONNABORTED', config as never, {});
    };
    jest.spyOn(NewJerseySheriffSaleHttpClient, 'getClient').mockReturnValue(client);

    await expect(getListingDetailsHtml({ propertyId: 42 })).rejects.toMatchObject({
      code: 'ECONNABORTED',
      message: 'timeout of 30000ms exceeded',
    });
    expect(mockedSaveHtmlToS3).not.toHaveBeenCalled();
  });

  it('rejects naming the property when the response body is empty', async () => {
    createClient((status) => ({ status, data: '' }));

    await expect(getListingDetailsHtml({ propertyId: 42 })).rejects.toThrow(
      'Empty listing details response for propertyId 42',
    );
  });

  it('still returns the html when archiving to S3 fails', async () => {
    createClient((status) => ({ status, data: '<table></table>' }));
    mockedSaveHtmlToS3.mockRejectedValue(new Error('getaddrinfo EBUSY'));

    await expect(getListingDetailsHtml({ propertyId: 42 })).resolves.toBe('<table></table>');
    expect(console.error).toHaveBeenCalledWith('Failed to save html for propertyId 42 to S3', expect.any(Error));
  });
});
