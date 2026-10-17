import { buildListingSnapshot, ListingSnapshot } from '../../src/services/listingSync/buildListingSnapshot';
import type { ListingSyncResult } from '../../src/services/listingSync/syncListing';
import { parseCountyProperyIds } from '../../src/services/newJerseySheriffSale/parseCountyProperyIds';
import { parseListingSnapshot } from '../../src/services/newJerseySheriffSale/parseListingSnapshot';
import { NJCounty } from '../../src/types';
import { ConcurrencyLimiter, createConcurrencyLimiter } from '../../src/utils';
import { ReplayArgs } from './args';
import { listingPageKey, planCountyDay } from './plan';

// Only this module's imports load for a dry run, so none of them may reach @sheriff-sale/database: importing it
// creates the client from DATABASE_URL. syncListing is passed in by index.ts instead.

export const DETAIL_PAGE_CONCURRENCY = 8;

export interface ReplayDeps {
  /** An archived page's text, or undefined when its key doesn't exist. */
  readText: (key: string) => Promise<string | undefined>;
  /** Not called on a dry run. */
  syncListing?: (snapshot: ListingSnapshot) => Promise<ListingSyncResult>;
}

export interface ReplayCounts {
  countyPagesRead: number;
  countyPagesMissing: number;
  /** County pages that failed to read (any error but a missing key) or to parse. */
  countyPagesFailed: number;
  /** Days with no county page of its own: Passaic before its county-ID fix. */
  preFixDaysSkipped: number;
  detailPagesFound: number;
  detailPagesMissing: number;
  /** Detail pages that failed to read with any error but a missing key. */
  detailPagesFailed: number;
  unrecognised: number;
  parseFailures: number;
  noSheriffId: number;
  /** Detail pages that parsed into a snapshot with a sheriff number, ready to sync. */
  parsed: number;
  inserted: number;
  updated: number;
  unchanged: number;
  statusInserted: number;
  statusExtended: number;
  syncFailures: number;
}

export interface ReplaySummary {
  byCounty: Map<NJCounty, ReplayCounts>;
  total: ReplayCounts;
  /** A read or a sync failed, so the command exits non-zero. */
  failed: boolean;
}

const emptyCounts = (): ReplayCounts => ({
  countyPagesRead: 0,
  countyPagesMissing: 0,
  countyPagesFailed: 0,
  preFixDaysSkipped: 0,
  detailPagesFound: 0,
  detailPagesMissing: 0,
  detailPagesFailed: 0,
  unrecognised: 0,
  parseFailures: 0,
  noSheriffId: 0,
  parsed: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  statusInserted: 0,
  statusExtended: 0,
  syncFailures: 0,
});

type DetailPageContext = {
  date: string;
  county: NJCounty;
  propertyId: number;
  counts: ReplayCounts;
  deps: ReplayDeps;
  dryRun: boolean;
};

/** Reads, parses and (unless a dry run) syncs one detail page. Never rejects: every outcome is counted. */
const replayDetailPage = async ({ date, county, propertyId, counts, deps, dryRun }: DetailPageContext) => {
  const key = listingPageKey(date, propertyId);

  let html: string | undefined;

  try {
    html = await deps.readText(key);
  } catch (error) {
    counts.detailPagesFailed++;
    console.error(`Failed to read ${key}`, error);

    return;
  }

  if (html === undefined) {
    counts.detailPagesMissing++;

    return;
  }

  let snapshot: ListingSnapshot;

  try {
    const page = parseListingSnapshot(html);

    if (page.layout === 'unrecognised') {
      counts.unrecognised++;

      return;
    }

    snapshot = buildListingSnapshot({ page, county, propertyId, snapshotDate: date });
  } catch (error) {
    counts.parseFailures++;
    console.error(`Failed to parse ${key}`, error);

    return;
  }

  if (!snapshot.listing.sheriffId) {
    counts.noSheriffId++;

    return;
  }

  counts.parsed++;

  if (dryRun || !deps.syncListing) {
    return;
  }

  try {
    const result = await deps.syncListing(snapshot);

    counts[result.listing]++;
    counts.statusInserted += result.statusInserted;
    counts.statusExtended += result.statusExtended;
  } catch (error) {
    counts.syncFailures++;
    console.error(`Failed to sync ${key}`, error);
  }
};

const replayCountyDay = async (
  date: string,
  county: NJCounty,
  counts: ReplayCounts,
  deps: ReplayDeps,
  dryRun: boolean,
  limit: ConcurrencyLimiter,
) => {
  const plan = planCountyDay(date, county);

  if (plan.skippedPreFix) {
    counts.preFixDaysSkipped++;

    return;
  }

  // Before the Passaic fix, Gloucester's two pages can list the same property ID.
  const propertyIds = new Set<number>();

  for (const key of plan.countyPageKeys) {
    let html: string | undefined;

    try {
      html = await deps.readText(key);
    } catch (error) {
      counts.countyPagesFailed++;
      console.error(`Failed to read ${key}`, error);
      continue;
    }

    if (html === undefined) {
      counts.countyPagesMissing++;
      continue;
    }

    counts.countyPagesRead++;

    try {
      (await parseCountyProperyIds(html)).forEach((propertyId) => propertyIds.add(propertyId));
    } catch (error) {
      counts.countyPagesFailed++;
      console.error(`Failed to parse ${key}`, error);
    }
  }

  counts.detailPagesFound += propertyIds.size;

  await Promise.all(
    [...propertyIds].map((propertyId) =>
      limit(() => replayDetailPage({ date, county: plan.syncAs, propertyId, counts, deps, dryRun })),
    ),
  );
};

/**
 * Replays each requested county's archived pages for each date, earliest first: the county page lists the day's
 * property IDs, and each one's detail page is parsed and synced as that county's snapshot for that date.
 * One page's failure never stops the run.
 */
export const replayArchive = async (
  { counties, dates, dryRun }: ReplayArgs,
  deps: ReplayDeps,
): Promise<ReplaySummary> => {
  const byCounty = new Map(counties.map((county) => [county, emptyCounts()]));
  const limit = createConcurrencyLimiter(DETAIL_PAGE_CONCURRENCY);

  for (const date of dates) {
    for (const county of counties) {
      await replayCountyDay(date, county, byCounty.get(county) as ReplayCounts, deps, dryRun, limit);
    }
  }

  const total = emptyCounts();

  byCounty.forEach((counts) => {
    (Object.keys(total) as (keyof ReplayCounts)[]).forEach((field) => {
      total[field] += counts[field];
    });
  });

  return {
    byCounty,
    total,
    failed: total.countyPagesFailed + total.detailPagesFailed + total.syncFailures > 0,
  };
};

const formatCounts = (counts: ReplayCounts, dryRun: boolean): string[] => [
  `county pages ${counts.countyPagesRead} read, ${counts.countyPagesMissing} missing, ` +
    `${counts.countyPagesFailed} failed` +
    (counts.preFixDaysSkipped > 0 ? `; ${counts.preFixDaysSkipped} days skipped as pre-fix (Gloucester's pages)` : ''),
  `detail pages ${counts.detailPagesFound} found, ${counts.detailPagesMissing} missing, ` +
    `${counts.detailPagesFailed} failed to read, ${counts.unrecognised} unrecognised, ` +
    `${counts.parseFailures} failed to parse, ${counts.noSheriffId} without a sheriff number, ${counts.parsed} parsed`,
  dryRun
    ? 'listings not synced (dry run)'
    : `listings ${counts.inserted} inserted, ${counts.updated} updated, ${counts.unchanged} unchanged, ` +
      `${counts.syncFailures} failed; status rows ${counts.statusInserted} inserted, ${counts.statusExtended} extended`,
];

export const formatReplaySummary = (summary: ReplaySummary, dryRun: boolean): string[] => [
  ...[...summary.byCounty].flatMap(([county, counts]) => [
    `${county}:`,
    ...formatCounts(counts, dryRun).map((line) => `  ${line}`),
  ]),
  'Total:',
  ...formatCounts(summary.total, dryRun).map((line) => `  ${line}`),
];
