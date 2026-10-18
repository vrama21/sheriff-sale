import { isAxiosError } from 'axios';
import { createConcurrencyLimiter } from '../../../shared/concurrency';

// Request politeness toward one clerk portal (design D9, press-scraping "Request politeness").

export const MIN_REQUEST_INTERVAL_MS = 1_500;
export const REQUEST_TIMEOUT_MS = 30_000;
export const RETRY_DELAY_MS = 5_000;
export const BLOCKED_AFTER_CONSECUTIVE = 3;

/** The host refused three requests in a row with 403 or 429; nothing more goes to it this run. */
export class HostBlockedError extends Error {
  public constructor(public readonly host: string) {
    super(
      `${host} answered ${BLOCKED_AFTER_CONSECUTIVE} requests in a row with 403/429; stopped requesting it this run`,
    );
    this.name = 'HostBlockedError';
  }
}

export type HostLimiter = {
  readonly host: string;
  /** Runs `request` once its turn comes, retrying a network error or 5xx once. */
  run<T>(request: () => Promise<T>): Promise<T>;
  readonly blocked: boolean;
};

export type HostLimiterOptions = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const statusOf = (error: unknown): number | undefined => (isAxiosError(error) ? error.response?.status : undefined);

/** A network error (no response) or a 5xx is worth one retry; a 4xx is not. */
const isRetryable = (error: unknown): boolean => {
  if (!isAxiosError(error)) {
    return false;
  }

  const status = error.response?.status;

  return status === undefined || status >= 500;
};

/**
 * One request at a time to `host`, each starting at least MIN_REQUEST_INTERVAL_MS after the previous one started.
 * Create one per host per run, so a block lasts only for the run.
 */
export const createHostLimiter = (host: string, { sleep = defaultSleep, now = Date.now }: HostLimiterOptions = {}) => {
  const serial = createConcurrencyLimiter(1);
  let lastStart = -Infinity;
  let refusals = 0;
  let blocked = false;

  const attempt = async <T>(request: () => Promise<T>): Promise<T> => {
    if (blocked) {
      throw new HostBlockedError(host);
    }

    const wait = lastStart + MIN_REQUEST_INTERVAL_MS - now();

    if (wait > 0) {
      await sleep(wait);
    }

    lastStart = now();

    try {
      const result = await request();
      refusals = 0;

      return result;
    } catch (error) {
      const status = statusOf(error);

      if (status === 403 || status === 429) {
        refusals++;

        if (refusals >= BLOCKED_AFTER_CONSECUTIVE) {
          blocked = true;
        }
      } else {
        refusals = 0;
      }

      throw error;
    }
  };

  const limiter: HostLimiter = {
    host,
    run: (request) =>
      serial(async () => {
        try {
          return await attempt(request);
        } catch (error) {
          if (!isRetryable(error)) {
            throw error;
          }

          console.warn(`Request to ${host} failed (${statusOf(error) ?? 'network error'}); retrying once`);
          await sleep(RETRY_DELAY_MS);

          return attempt(request);
        }
      }),
    get blocked() {
      return blocked;
    },
  };

  return limiter;
};
