import { Address, parseAddress } from '../../../shared/address';
import { NJCounty } from '../../../shared/nj';
import {
  FieldWarning,
  ScrapedListingDetails,
  StatusHistoryRow,
  validateListingDetails,
  validateStatusHistory,
} from '../parse/listingSchema';
import { ParsedListingPage } from '../parse/parseListingSnapshot';
import { contentHash } from './contentHash';
import { normalizeSheriffId, normalizeStatus } from './normalize';

// The listing fields a snapshot sets: what listingSchema validates and parseAddress splits out (state included),
// plus county. latitude, longitude and mapsUrl aren't scraped, so a sync never overwrites them.
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
] as const satisfies readonly (keyof SnapshotListing)[];

export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];

/** Every snapshot field is present, null when the page didn't have it, so an update clears what the page dropped. */
export type SnapshotListing = Omit<ScrapedListingDetails, 'sheriffId'> &
  Address & {
    county: NJCounty;
    propertyId: number;
    sheriffId: string | null;
  };

/** One listing as one archived or scraped page showed it on one day, ready to sync. */
export type ListingSnapshot = {
  listing: SnapshotListing;
  statusHistory: StatusHistoryRow[];
  /** The archive date of the page, `YYYY-MM-DD`. */
  snapshotDate: string;
  contentHash: string;
};

export type BuildListingSnapshotArgs = {
  page: ParsedListingPage;
  county: NJCounty;
  propertyId: number;
  snapshotDate: string;
};

/**
 * Validates a parsed page with listingSchema and builds its snapshot: the address split by parseAddress, the sheriff
 * number and status rows normalized, rows that are the same once normalized dropped, and the fields hashed.
 * Every bad value, a missing address included, is in `warnings`.
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
    ...parseAddress(details.address),
    county,
    propertyId,
    sheriffId: normalizeSheriffId(details.sheriffId),
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
