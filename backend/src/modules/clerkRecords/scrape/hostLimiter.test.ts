import { AxiosError, AxiosHeaders } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createHostLimiter, HostBlockedError } from './hostLimiter';

const httpError = (status: number) =>
  new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: '',
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createHostLimiter', () => {
  it('never overlaps requests and starts them at least 1.5 s apart', async () => {
    const limiter = createHostLimiter('press.burlingtoncountynj.gov');
    const starts: number[] = [];
    let active = 0;
    let maxActive = 0;

    const request = () =>
      limiter.run(async () => {
        starts.push(Date.now());
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 200));
        active--;

        return 'ok';
      });

    const all = Promise.all([request(), request(), request()]);
    await vi.runAllTimersAsync();
    await all;

    expect(maxActive).toBe(1);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1_500);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1_500);
  });

  it('retries a 5xx once, 5 seconds later, and returns the retry', async () => {
    const limiter = createHostLimiter('press.essexregister.com');
    const starts: number[] = [];
    const request = vi.fn(() => {
      starts.push(Date.now());

      return starts.length === 1 ? Promise.reject(httpError(503)) : Promise.resolve('page');
    });

    const result = limiter.run(request);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe('page');
    expect(request).toHaveBeenCalledTimes(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(5_000);
  });

  it('retries a network error once and then gives up', async () => {
    const limiter = createHostLimiter('press.essexregister.com');
    const networkError = new AxiosError('socket hang up', 'ECONNRESET');
    const request = vi.fn().mockRejectedValue(networkError);

    const result = limiter.run(request);
    const assertion = expect(result).rejects.toBe(networkError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx', async () => {
    const limiter = createHostLimiter('press.essexregister.com');
    const request = vi.fn().mockRejectedValue(httpError(404));

    const result = limiter.run(request);
    const assertion = expect(result).rejects.toMatchObject({ response: { status: 404 } });
    await vi.runAllTimersAsync();
    await assertion;
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('stops requesting a host after three 429s in a row', async () => {
    const limiter = createHostLimiter('press.essexregister.com');
    const request = vi.fn().mockRejectedValue(httpError(429));

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = limiter.run(request);
      const assertion = expect(result).rejects.toMatchObject({ response: { status: 429 } });
      await vi.runAllTimersAsync();
      await assertion;
    }

    // The third refusal is the block itself, so the listing that drew it isn't recorded as an error.
    const third = limiter.run(request);
    const thirdAssertion = expect(third).rejects.toBeInstanceOf(HostBlockedError);
    await vi.runAllTimersAsync();
    await thirdAssertion;
    expect(limiter.blocked).toBe(true);

    const blocked = limiter.run(request);
    const assertion = expect(blocked).rejects.toBeInstanceOf(HostBlockedError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('resets the refusal count after a success', async () => {
    const limiter = createHostLimiter('press.essexregister.com');
    const outcomes = [429, 429, 200, 429, 429];

    for (const status of outcomes) {
      const result = limiter.run(() => (status === 200 ? Promise.resolve('ok') : Promise.reject(httpError(status))));
      const settled = result.catch(() => undefined);
      await vi.runAllTimersAsync();
      await settled;
    }

    expect(limiter.blocked).toBe(false);
  });
});
