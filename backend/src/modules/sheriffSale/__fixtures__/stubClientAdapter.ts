import { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NewJerseySheriffSaleHttpClient } from '../scrape/newJerseySheriffSaleHttpClient';

export const readFixture = (name: string) => readFileSync(join(__dirname, name), 'utf8');

export type StubRequest = {
  url?: string;
  params?: Record<string, string>;
  cookie?: string;
  maxRedirects?: number;
};

export type StubResponse = {
  status: number;
  data?: unknown;
  headers?: Record<string, string | string[]>;
};

/**
 * Makes the client's requests never leave the process: `respond` plays the server.
 * Rejects the way axios does when `validateStatus` fails. Returns the requests the server saw.
 */
export const stubClientAdapter = (
  client: NewJerseySheriffSaleHttpClient,
  respond: (request: StubRequest) => StubResponse,
): StubRequest[] => {
  const requests: StubRequest[] = [];
  const axiosInstance = (client as unknown as { axiosInstance: { defaults: { adapter: unknown } } }).axiosInstance;

  axiosInstance.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const request: StubRequest = {
      url: config.url,
      params: config.params,
      cookie: config.headers?.['Cookie'] as string | undefined,
      maxRedirects: config.maxRedirects,
    };
    requests.push(request);

    const { status, data = '', headers = {} } = respond(request);
    const response = { status, data, statusText: '', headers, config, request: {} };

    if (config.validateStatus && !config.validateStatus(status)) {
      throw new AxiosError(
        `Request failed with status code ${status}`,
        status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST',
        config,
        {},
        response,
      );
    }

    return response;
  };

  return requests;
};
