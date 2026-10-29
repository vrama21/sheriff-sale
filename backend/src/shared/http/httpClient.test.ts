import { AxiosError } from 'axios';
import { describe, expect, it } from 'vite-plus/test';
import { HttpClient } from './httpClient';

describe('HttpClient', () => {
  it('rethrows an error raised before any request was made, without its Authorization header', async () => {
    const client = new HttpClient({ authToken: 'secret' });
    let thrown: AxiosError | undefined;

    // Rejects the way axios does when it can't build a request (an invalid URL): no `request` is attached.
    client['axiosInstance'].defaults.adapter = async (config) => {
      thrown = new AxiosError('Invalid URL', 'ERR_INVALID_URL', config);
      throw thrown;
    };

    const rejection = await client.get('/listings').catch((error: unknown) => error);

    expect(rejection).toBe(thrown);
    expect(thrown?.config?.headers['Authorization']).toBeUndefined();
  });

  it('sends no Authorization header without a token', async () => {
    const client = new HttpClient({});
    let sent: unknown = 'not sent';

    client['axiosInstance'].defaults.adapter = async (config) => {
      sent = config.headers['Authorization'];

      return { data: '', status: 200, statusText: 'OK', headers: {}, config };
    };

    await client.get('/listings');

    expect(sent).toBeUndefined();
  });
});
