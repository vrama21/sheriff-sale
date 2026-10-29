import { and, db, drizzleSql as sql, eq, ListingInsert, listings, statusHistories } from '@sheriff-sale/database';
import { ListingSnapshot, SNAPSHOT_FIELDS } from './buildListingSnapshot';

export type ListingSyncOutcome = 'inserted' | 'updated' | 'unchanged';

export type ListingSyncResult = {
  listing: ListingSyncOutcome;
  /** Status rows the listing didn't have yet. */
  statusInserted: number;
  /** Stored status rows whose firstSeenOn moved earlier or lastSeenOn moved later. */
  statusExtended: number;
};

// Typed by column so a snapshot field that isn't a Listing column fails to compile rather than every update.
const excluded = (column: Extract<keyof ListingInsert, string>) => sql.raw(`excluded."${column}"`);

// Every field the snapshot owns takes the snapshot's value; latitude, longitude and mapsUrl are left alone.
const UPDATED_COLUMNS = [...SNAPSHOT_FIELDS, 'propertyId', 'contentHash', 'snapshotDate'] as const;
const listingUpdateSet = {
  ...Object.fromEntries(UPDATED_COLUMNS.map((column) => [column, excluded(column)])),
  updatedAt: sql`now()`,
};

/**
 * Writes one snapshot in one transaction. The listing, matched by county and sheriff number, is inserted, or
 * updated only when its fields changed and the snapshot is at least as new as the stored one. Its status rows are
 * merged either way: new rows are inserted, and stored rows widen their first/last-seen dates. Nothing is deleted,
 * so syncing snapshots in any order, or the same one twice, gives the same rows.
 *
 * Rejects without opening a transaction when the snapshot has no sheriff number. The snapshot's status rows must
 * be distinct, as buildListingSnapshot makes them.
 */
export const syncListing = async (snapshot: ListingSnapshot): Promise<ListingSyncResult> => {
  const { listing, statusHistory, snapshotDate, contentHash } = snapshot;

  const { sheriffId } = listing;

  // NULL never conflicts in the unique index, so a listing without a sheriff number could only ever be inserted.
  if (!sheriffId) {
    throw new Error(`Listing propertyId ${listing.propertyId} in ${listing.county} County has no sheriff number`);
  }

  return db.transaction(async (tx) => {
    const [upserted] = await tx
      .insert(listings)
      .values({ ...listing, snapshotDate, contentHash })
      .onConflictDoUpdate({
        target: [listings.county, listings.sheriffId],
        set: listingUpdateSet,
        setWhere: sql`${listings.contentHash} IS DISTINCT FROM excluded."contentHash"
          AND (${listings.snapshotDate} IS NULL OR excluded."snapshotDate" >= ${listings.snapshotDate})`,
      })
      .returning({ id: listings.id, inserted: sql<boolean>`(xmax = 0)` });

    let listingId = upserted?.id;
    let outcome: ListingSyncOutcome;

    if (upserted) {
      outcome = upserted.inserted ? 'inserted' : 'updated';
    } else {
      // The update's guard held, so Postgres returned no row; the listing is stored and still needs its status rows.
      outcome = 'unchanged';

      const [stored] = await tx
        .select({ id: listings.id })
        .from(listings)
        .where(and(eq(listings.county, listing.county), eq(listings.sheriffId, sheriffId)));

      listingId = stored?.id;
    }

    if (!listingId) {
      throw new Error(`Listing ${sheriffId} in ${listing.county} County was neither written nor found`);
    }

    if (statusHistory.length === 0) {
      return { listing: outcome, statusInserted: 0, statusExtended: 0 };
    }

    const merged = await tx
      .insert(statusHistories)
      .values(
        statusHistory.map(({ status, date }) => ({
          listingId,
          status,
          date,
          firstSeenOn: snapshotDate,
          lastSeenOn: snapshotDate,
        })),
      )
      .onConflictDoUpdate({
        target: [statusHistories.listingId, statusHistories.status, statusHistories.date],
        set: {
          firstSeenOn: sql`LEAST(${statusHistories.firstSeenOn}, excluded."firstSeenOn")`,
          lastSeenOn: sql`GREATEST(${statusHistories.lastSeenOn}, excluded."lastSeenOn")`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`excluded."firstSeenOn" < ${statusHistories.firstSeenOn}
          OR excluded."lastSeenOn" > ${statusHistories.lastSeenOn}`,
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });

    const statusInserted = merged.filter((row) => row.inserted).length;

    return { listing: outcome, statusInserted, statusExtended: merged.length - statusInserted };
  });
};
