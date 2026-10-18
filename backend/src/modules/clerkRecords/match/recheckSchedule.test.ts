import { DateTime } from 'luxon';
import { describe, expect, it } from 'vite-plus/test';
import { LookupCounters, scheduleNextLookup, ScheduledOutcome } from './recheckSchedule';

const at = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' });
const fresh: LookupCounters = { consecutiveMisses: 0, consecutiveErrors: 0 };

describe('scheduleNextLookup', () => {
  it.each<[string, ScheduledOutcome, LookupCounters, string, string, string | null, LookupCounters]>([
    [
      'matched, sale in 3 weeks: 14 days',
      'matched',
      fresh,
      '2026-10-22',
      '2026-10-01T12:00:00Z',
      '2026-10-15T12:00:00.000Z',
      fresh,
    ],
    [
      'matched before a sale in a week: the sale date',
      'matched',
      fresh,
      '2026-10-08',
      '2026-10-01T12:00:00Z',
      '2026-10-08T00:00:00.000Z',
      fresh,
    ],
    [
      'matched resets the miss count',
      'matched',
      { consecutiveMisses: 3, consecutiveErrors: 2 },
      '2026-12-01',
      '2026-10-01T00:00:00Z',
      '2026-10-15T00:00:00.000Z',
      fresh,
    ],
    [
      'first miss: 7 days',
      'no_lis_pendens',
      fresh,
      '2026-12-01',
      '2026-10-01T00:00:00Z',
      '2026-10-08T00:00:00.000Z',
      { consecutiveMisses: 1, consecutiveErrors: 0 },
    ],
    [
      'second miss: 7 days',
      'no_lis_pendens',
      { consecutiveMisses: 1, consecutiveErrors: 0 },
      '2026-12-01',
      '2026-10-01T00:00:00Z',
      '2026-10-08T00:00:00.000Z',
      { consecutiveMisses: 2, consecutiveErrors: 0 },
    ],
    [
      'sixth miss: 30 days',
      'no_lis_pendens',
      { consecutiveMisses: 5, consecutiveErrors: 0 },
      '2027-03-01',
      '2026-10-01T00:00:00Z',
      '2026-10-31T00:00:00.000Z',
      { consecutiveMisses: 6, consecutiveErrors: 0 },
    ],
    [
      'after the sale, no sheriff deed: sale + 30',
      'matched',
      fresh,
      '2026-09-01',
      '2026-09-05T00:00:00Z',
      '2026-10-01T00:00:00.000Z',
      fresh,
    ],
    [
      'after sale + 30: sale + 60',
      'matched',
      fresh,
      '2026-09-01',
      '2026-10-01T00:00:00Z',
      '2026-10-31T00:00:00.000Z',
      fresh,
    ],
    [
      'after sale + 60: sale + 90',
      'no_lis_pendens',
      fresh,
      '2026-09-01',
      '2026-10-31T00:00:00Z',
      '2026-11-30T00:00:00.000Z',
      { consecutiveMisses: 1, consecutiveErrors: 0 },
    ],
    ['after sale + 90: stop', 'matched', fresh, '2026-09-01', '2026-11-30T00:00:00Z', null, fresh],
    ['sheriff deed matched: stop', 'complete', fresh, '2026-09-01', '2026-10-01T00:00:00Z', null, fresh],
    ['county unsupported: never', 'unsupported', fresh, '2026-12-01', '2026-10-01T00:00:00Z', null, fresh],
    [
      'first error: 1 day',
      'error',
      fresh,
      '2026-12-01',
      '2026-10-01T00:00:00Z',
      '2026-10-02T00:00:00.000Z',
      { consecutiveMisses: 0, consecutiveErrors: 1 },
    ],
    [
      'fifth error: 7 days',
      'error',
      { consecutiveMisses: 2, consecutiveErrors: 4 },
      '2026-12-01',
      '2026-10-01T00:00:00Z',
      '2026-10-08T00:00:00.000Z',
      { consecutiveMisses: 2, consecutiveErrors: 5 },
    ],
  ])('%s', (_name, outcome, previous, saleDate, now, nextCheckAt, counters) => {
    const next = scheduleNextLookup(outcome, previous, saleDate, at(now));

    expect(next.nextCheckAt?.toISOString() ?? null).toBe(nextCheckAt);
    expect({ consecutiveMisses: next.consecutiveMisses, consecutiveErrors: next.consecutiveErrors }).toEqual(counters);
  });

  it('treats the sale date itself as before the sale', () => {
    expect(
      scheduleNextLookup('matched', fresh, '2026-10-08', at('2026-10-08T09:00:00Z')).nextCheckAt?.toISOString(),
    ).toBe('2026-10-08T00:00:00.000Z');
  });
});
