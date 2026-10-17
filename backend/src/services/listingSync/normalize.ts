// packages/database/drizzle/0010_repair_listing_identity.sql applies these same rules to stored rows in SQL.
// Change both together: a replayed row only dedupes against a stored one if both give the same value.
// Status dates need no rule here: listingSchema's toIsoDate makes them `YYYY-MM-DD`, as 0008 did for stored rows.

/** Removes all whitespace: "\r F-24000056   " -> "F-24000056". A missing or blank sheriff number is null. */
export const normalizeSheriffId = (sheriffId: string | null | undefined): string | null =>
  (sheriffId ?? '').replace(/\s+/g, '') || null;

/** Collapses whitespace runs to one space and trims. */
export const normalizeStatus = (status: string): string => status.replace(/\s+/g, ' ').trim();
