import { NJCounty } from '../../types';
import { cleanAddress } from '../newJerseySheriffSale/cleanAddress';
import {
  FieldWarning,
  RawStatusRow,
  ScrapedListingDetails,
  StatusHistoryRow,
  validateListingDetails,
  validateStatusHistory,
} from '../newJerseySheriffSale/listingSchema';
import { contentHash } from './contentHash';
import { normalizeSheriffId, normalizeStatus } from './normalize';

// The listing fields a snapshot sets: what listingSchema validates and cleanAddress splits out, plus county and
// state. latitude, longitude and mapsUrl aren't scraped, so a sync never overwrites them.
export const SNAPSHOT_FIELDS = [
  'address',
  'attorney',
  'attorneyPhone',
  'city',
  'county',
  'courtCase',
  'deed',
  'deedAddress',
  'defendant',
  'description',
  'judgment',
  'parcel',
  'plaintiff',
  'priors',
  'saleDate',
  'secondaryUnit',
  'sheriffId',
  'state',
  'street',
  'unit',
  'upsetAmount',
  'zipcode',
] as const;

export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];

/** Every snapshot field is present, null when the page didn't have it, so an update clears what the page dropped. */
export type SnapshotListing = Omit<ScrapedListingDetails, 'sheriffId'> &
  ReturnType<typeof cleanAddress> & {
    county: NJCounty;
    propertyId: number;
    sheriffId: string | null;
    state: string;
  };

/** One listing as one archived or scraped page showed it on one day, ready to sync. */
export type ListingSnapshot = {
  listing: SnapshotListing;
  statusHistory: StatusHistoryRow[];
  /** The archive date of the page, `YYYY-MM-DD`. */
  snapshotDate: string;
  contentHash: string;
};

/** A details page's raw text, before it's validated and tied to a county and a day. */
export type ParsedListingPage = {
  listing: Record<string, string>;
  statusHistory: RawStatusRow[];
};

export type BuildListingSnapshotArgs = {
  page: ParsedListingPage;
  county: NJCounty;
  propertyId: number;
  snapshotDate: string;
};

/**
 * Validates a parsed page with listingSchema and builds its snapshot: the address split by cleanAddress, the sheriff
 * number and status rows normalized, rows that are the same once normalized dropped, and the fields hashed.
 * Throws when listingSchema rejects the page (no address); every other bad value is in `warnings`.
 */
export const buildListingSnapshot = ({
  page,
  county,
  propertyId,
  snapshotDate,
}: BuildListingSnapshotArgs): { snapshot: ListingSnapshot; warnings: FieldWarning[] } => {
  const { details, warnings: detailWarnings } = validateListingDetails(page.listing);
  const { rows, warnings: historyWarnings } = validateStatusHistory(page.statusHistory);

  const listing: SnapshotListing = {
    ...details,
    ...cleanAddress(details.address),
    county,
    propertyId,
    sheriffId: normalizeSheriffId(details.sheriffId),
    state: 'NJ',
  };

  const statusRows = new Map<string, StatusHistoryRow>();

  rows.forEach((row) => {
    const status = normalizeStatus(row.status);

    statusRows.set(JSON.stringify([status, row.date]), { status, date: row.date });
  });

  return {
    snapshot: {
      listing,
      statusHistory: [...statusRows.values()],
      snapshotDate,
      contentHash: contentHash(listing),
    },
    warnings: [...detailWarnings, ...historyWarnings],
  };
};
