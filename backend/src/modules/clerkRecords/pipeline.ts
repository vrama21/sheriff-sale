import { DateTime } from 'luxon';
import { NJCounty } from '../../shared/nj';
import {
  MAX_LISTINGS_PER_COUNTY_PER_RUN,
  recordLookupError,
  recordUnsupported,
  saveLookupResult,
  selectCandidates,
} from './ingest/lookupState';
import { ListingForLookup, LookupDeadlineError, matchListing } from './match/matchListing';
import { HostBlockedError } from './scrape/hostLimiter';
import { PRESS_COUNTIES } from './scrape/platforms/press/counties';
import { PressClient } from './scrape/platforms/press/pressClient';
import { ClerkParseError, ClerkPlatformClient } from './scrape/types';

/** A lookup still running this long after the run started is left for the next run (design D9). */
export const RUN_DEADLINE_MS = 780_000;

/** The counties with a clerk platform client. */
export const SUPPORTED_COUNTIES = Object.keys(PRESS_COUNTIES) as NJCounty[];

export type CountyLookupSummary = {
  county: NJCounty;
  attempted: number;
  matched: number;
  noLisPendens: number;
  complete: number;
  errors: number;
  parseErrors: number;
  truncatedSearches: number;
  unmappedDocTypes: string[];
  /** Due listings not looked up: past the deadline, or after the host blocked us. */
  leftForNextRun: number;
  blocked: boolean;
};

export type CountyLookupOptions = {
  runStart?: DateTime;
  deadlineAt?: number;
  limit?: number;
  clientFor?: (county: NJCounty) => ClerkPlatformClient | undefined;
};

const logSummary = (summary: CountyLookupSummary) =>
  console.log(
    `Clerk records ${summary.county} County: attempted ${summary.attempted}, lis pendens matched ${summary.matched}, ` +
      `complete ${summary.complete}, no lis pendens ${summary.noLisPendens}, errors ${summary.errors} ` +
      `(parse errors ${summary.parseErrors}), truncated searches ${summary.truncatedSearches}, ` +
      `left for next run ${summary.leftForNextRun}${summary.blocked ? ', host blocked' : ''}, ` +
      `unmapped doc types [${summary.unmappedDocTypes.join('; ')}]`,
  );

/**
 * Looks up one county's due listings, nearest sale first, one at a time through its host's limiter. A failed listing
 * is recorded as an error and doesn't stop the rest. Rejects when the county failed: its host blocked us, or every
 * attempted lookup failed.
 */
export const runCountyLookups = async (
  county: NJCounty,
  {
    runStart = DateTime.utc(),
    deadlineAt = runStart.toMillis() + RUN_DEADLINE_MS,
    limit = MAX_LISTINGS_PER_COUNTY_PER_RUN,
    clientFor = (name) => PressClient.forCounty(name),
  }: CountyLookupOptions = {},
): Promise<CountyLookupSummary> => {
  const summary: CountyLookupSummary = {
    county,
    attempted: 0,
    matched: 0,
    noLisPendens: 0,
    complete: 0,
    errors: 0,
    parseErrors: 0,
    truncatedSearches: 0,
    unmappedDocTypes: [],
    leftForNextRun: 0,
    blocked: false,
  };
  const client = clientFor(county);
  const candidates = await selectCandidates(county, runStart, limit);
  const pastDeadline = () => Date.now() >= deadlineAt;
  const unmapped = new Set<string>();

  console.log(`Clerk records ${county} County: ${candidates.length} listings due`);

  for (const [index, listing] of candidates.entries()) {
    if (!client) {
      await recordUnsupported(listing, runStart);
      continue;
    }

    if (pastDeadline()) {
      summary.leftForNextRun = candidates.length - index;
      break;
    }

    summary.attempted++;

    const outcome = await lookUpListing(client, listing, pastDeadline);

    if (outcome.kind === 'deadline' || outcome.kind === 'blocked') {
      summary.attempted--;
      summary.leftForNextRun = candidates.length - index;
      summary.blocked = outcome.kind === 'blocked';
      break;
    }

    if (outcome.kind === 'error') {
      summary.errors++;
      summary.parseErrors += outcome.parseError ? 1 : 0;
      continue;
    }

    const { result } = outcome;

    summary.truncatedSearches += result.truncatedSearches;
    result.unmappedDocTypes.forEach((description) => unmapped.add(description));

    if (result.outcome === 'matched') {
      summary.matched++;
    } else if (result.outcome === 'complete') {
      summary.complete++;
    } else {
      summary.noLisPendens++;
    }
  }

  summary.unmappedDocTypes = [...unmapped];
  logSummary(summary);

  if (summary.blocked) {
    throw new Error(`Clerk records ${county} County failed: its host is refusing requests`);
  }

  if (summary.attempted > 0 && summary.errors === summary.attempted) {
    throw new Error(`Clerk records ${county} County failed: all ${summary.attempted} lookups failed`);
  }

  return summary;
};

type ListingLookupOutcome =
  | { kind: 'done'; result: Awaited<ReturnType<typeof matchListing>> }
  | { kind: 'error'; parseError: boolean }
  | { kind: 'deadline' }
  | { kind: 'blocked' };

/** One listing's lookup and write. A failure is logged with the listing and county and recorded as an `error`. */
const lookUpListing = async (
  client: ClerkPlatformClient,
  listing: ListingForLookup,
  pastDeadline: () => boolean,
): Promise<ListingLookupOutcome> => {
  const now = DateTime.utc();
  let result: Awaited<ReturnType<typeof matchListing>>;

  try {
    result = await matchListing(client, listing, { now, pastDeadline });
  } catch (error) {
    if (error instanceof LookupDeadlineError) {
      return { kind: 'deadline' };
    }

    if (error instanceof HostBlockedError) {
      return { kind: 'blocked' };
    }

    console.error(`Clerk records lookup failed for listing ${listing.id} in ${listing.county} County`, error);
    await recordError(client, listing, error, now);

    return { kind: 'error', parseError: error instanceof ClerkParseError };
  }

  try {
    const written = await saveLookupResult(listing, client.platform, result, now);

    console.log(
      `Clerk records listing ${listing.id} in ${listing.county} County: ${result.outcome}, ` +
        `${written.documents} documents, ${written.matches} matches, next check ${written.nextCheckAt?.toISOString() ?? 'none'}`,
    );

    return { kind: 'done', result };
  } catch (error) {
    console.error(`Clerk records write failed for listing ${listing.id} in ${listing.county} County`, error);
    await recordError(client, listing, error, now);

    return { kind: 'error', parseError: false };
  }
};

const recordError = async (client: ClerkPlatformClient, listing: ListingForLookup, error: unknown, now: DateTime) => {
  try {
    await recordLookupError(listing, client.platform, error, now);
  } catch (writeError) {
    console.error(`Could not record the lookup error for listing ${listing.id}`, writeError);
  }
};
