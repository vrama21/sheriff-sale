import { DateTime } from 'luxon';

// When to look a listing up again (design D10, clerk-records-matching "Re-check schedule").

export const MATCHED_RECHECK_DAYS = 14;
export const MISS_RECHECK_DAYS = 7;
export const MISSES_BEFORE_SLOWDOWN = 6;
export const SLOW_MISS_RECHECK_DAYS = 30;
export const ERROR_RECHECK_DAYS = 1;
export const ERRORS_BEFORE_BACKOFF = 5;
export const ERROR_BACKOFF_DAYS = 7;
export const POST_SALE_CHECK_DAYS = [30, 60, 90];

export type ScheduledOutcome = 'matched' | 'no_lis_pendens' | 'complete' | 'unsupported' | 'error';

export type LookupCounters = { consecutiveMisses: number; consecutiveErrors: number };

export type NextLookup = LookupCounters & { nextCheckAt: Date | null };

/** The sale's day has passed: a lookup on the sale date itself is still before the sale. */
export const saleHasPassed = (saleDate: string, now: DateTime): boolean =>
  saleDate < (now.toUTC().toISODate() as string);

/**
 * The listing's next check and counters after a lookup with `outcome`, from its counters before it. Null means no
 * further checks.
 */
export const scheduleNextLookup = (
  outcome: ScheduledOutcome,
  previous: LookupCounters,
  saleDate: string,
  now: DateTime,
): NextLookup => {
  const sale = DateTime.fromISO(saleDate, { zone: 'utc' });
  const at = (date: DateTime) => date.toJSDate();

  switch (outcome) {
    case 'complete':
    case 'unsupported':
      return { nextCheckAt: null, consecutiveMisses: 0, consecutiveErrors: 0 };

    case 'error': {
      const consecutiveErrors = previous.consecutiveErrors + 1;
      const days = consecutiveErrors >= ERRORS_BEFORE_BACKOFF ? ERROR_BACKOFF_DAYS : ERROR_RECHECK_DAYS;

      return { nextCheckAt: at(now.plus({ days })), consecutiveMisses: previous.consecutiveMisses, consecutiveErrors };
    }

    case 'matched':
    case 'no_lis_pendens': {
      const consecutiveMisses = outcome === 'matched' ? 0 : previous.consecutiveMisses + 1;

      // After the sale, look for the sheriff's deed at sale + 30, + 60 and + 90 days, then stop.
      if (saleHasPassed(saleDate, now)) {
        const next = POST_SALE_CHECK_DAYS.map((days) => sale.plus({ days })).find((date) => date > now);

        return { nextCheckAt: next ? at(next) : null, consecutiveMisses, consecutiveErrors: 0 };
      }

      let days = MATCHED_RECHECK_DAYS;

      if (outcome === 'no_lis_pendens') {
        days = consecutiveMisses >= MISSES_BEFORE_SLOWDOWN ? SLOW_MISS_RECHECK_DAYS : MISS_RECHECK_DAYS;
      }

      // Never past the sale date, so the last check before the sale isn't skipped (design D10).
      return { nextCheckAt: at(DateTime.min(now.plus({ days }), sale)), consecutiveMisses, consecutiveErrors: 0 };
    }
  }
};
