import { and, asc, db, eq, gte, isNull, listingClerkLookups, listings, lte, or } from '@sheriff-sale/database';
import { DateTime } from 'luxon';
import { NJCounty } from '../../../shared/nj';
import { ListingForLookup, ListingMatchResult } from '../match/matchListing';
import { LookupCounters, scheduleNextLookup, ScheduledOutcome } from '../match/recheckSchedule';
import { ClerkPlatform } from '../scrape/types';
import { syncClerkDocuments, Tx } from './syncClerkDocuments';
import { syncListingMatches } from './syncListingMatches';

/** Listings looked up per county per run, nearest sale first (design D9). */
export const MAX_LISTINGS_PER_COUNTY_PER_RUN = 40;
/** A sale further in the past than this is never looked up. */
export const MAX_DAYS_SINCE_SALE = 90;

const ERROR_TEXT_LIMIT = 2_000;

/**
 * The county's listings whose lookup is due at `runStart`: no lookup state yet, or a nextCheckAt at or before it, and
 * a sale no more than MAX_DAYS_SINCE_SALE days ago. A listing whose checks have stopped (a null nextCheckAt) isn't due.
 */
export const selectCandidates = async (
  county: NJCounty,
  runStart: DateTime,
  limit = MAX_LISTINGS_PER_COUNTY_PER_RUN,
): Promise<ListingForLookup[]> => {
  const earliestSale = runStart.minus({ days: MAX_DAYS_SINCE_SALE }).toISODate() as string;

  const rows = await db
    .select({
      id: listings.id,
      county: listings.county,
      defendant: listings.defendant,
      plaintiff: listings.plaintiff,
      courtCase: listings.courtCase,
      saleDate: listings.saleDate,
      city: listings.city,
      parcel: listings.parcel,
      description: listings.description,
    })
    .from(listings)
    .leftJoin(listingClerkLookups, eq(listingClerkLookups.listingId, listings.id))
    .where(
      and(
        eq(listings.county, county),
        gte(listings.saleDate, earliestSale),
        or(isNull(listingClerkLookups.listingId), lte(listingClerkLookups.nextCheckAt, runStart.toJSDate())),
      ),
    )
    .orderBy(asc(listings.saleDate), asc(listings.id))
    .limit(limit);

  return rows.flatMap((row) => (row.saleDate ? [{ ...row, county, saleDate: row.saleDate }] : []));
};

const readCounters = async (tx: Tx, listingId: string): Promise<LookupCounters> => {
  const [stored] = await tx
    .select({
      consecutiveMisses: listingClerkLookups.consecutiveMisses,
      consecutiveErrors: listingClerkLookups.consecutiveErrors,
    })
    .from(listingClerkLookups)
    .where(eq(listingClerkLookups.listingId, listingId));

  return stored ?? { consecutiveMisses: 0, consecutiveErrors: 0 };
};

const writeLookupState = async (
  tx: Tx,
  listing: Pick<ListingForLookup, 'id' | 'saleDate'>,
  platform: ClerkPlatform | null,
  outcome: ScheduledOutcome,
  now: DateTime,
  lastError: string | null,
) => {
  const next = scheduleNextLookup(outcome, await readCounters(tx, listing.id), listing.saleDate, now);
  const values = {
    listingId: listing.id,
    platform,
    lastCheckedAt: now.toJSDate(),
    nextCheckAt: next.nextCheckAt,
    lastOutcome: outcome,
    consecutiveMisses: next.consecutiveMisses,
    consecutiveErrors: next.consecutiveErrors,
    lastError: lastError?.slice(0, ERROR_TEXT_LIMIT) ?? null,
  };

  const { listingId: _listingId, ...update } = values;

  await tx
    .insert(listingClerkLookups)
    .values(values)
    .onConflictDoUpdate({ target: listingClerkLookups.listingId, set: update });

  return next;
};

export type LookupWriteSummary = { documents: number; matches: number; nextCheckAt: Date | null };

/**
 * Writes one lookup's documents, parties, links, matches and lookup state in one transaction, so a failure partway
 * leaves none of them (clerk-records-storage "Atomic per-listing write").
 */
export const saveLookupResult = async (
  listing: ListingForLookup,
  platform: ClerkPlatform,
  result: ListingMatchResult,
  now: DateTime,
): Promise<LookupWriteSummary> =>
  db.transaction(async (tx) => {
    const seenAt = now.toJSDate();
    const ids = await syncClerkDocuments(tx, result.documents, seenAt);
    const matches = await syncListingMatches(tx, listing.id, result.matches, ids, seenAt);
    const next = await writeLookupState(tx, listing, platform, result.outcome, now, null);

    return { documents: ids.size, matches, nextCheckAt: next.nextCheckAt };
  });

/** Records a failed lookup as an `error` outcome, in its own transaction. */
export const recordLookupError = async (
  listing: Pick<ListingForLookup, 'id' | 'saleDate'>,
  platform: ClerkPlatform,
  error: unknown,
  now: DateTime,
): Promise<void> => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  await db.transaction((tx) => writeLookupState(tx, listing, platform, 'error', now, message));
};

/** Records that the listing's county has no supported clerk platform; it's never looked up again. */
export const recordUnsupported = async (listing: Pick<ListingForLookup, 'id' | 'saleDate'>, now: DateTime) => {
  await db.transaction((tx) => writeLookupState(tx, listing, null, 'unsupported', now, null));
};
