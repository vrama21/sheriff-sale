import { createConcurrencyLimiter } from '../../shared/concurrency';
import { NJCounty } from '../../shared/nj';
import { buildListingSnapshot, ListingSnapshot } from './ingest/buildListingSnapshot';
import { ListingSyncResult, syncListing } from './ingest/syncListing';
import { FieldWarning } from './parse/listingSchema';
import { parseCountyPropertyIds } from './parse/parseCountyPropertyIds';
import { parseListingSnapshot } from './parse/parseListingSnapshot';
import { getCountyListingsHtml } from './scrape/getCountyListingsHtml';
import { getListingDetailsHtml } from './scrape/getListingDetailsHtml';
import { NewJerseySheriffSaleHttpClient } from './scrape/newJerseySheriffSaleHttpClient';
import { todaysArchiveDate } from './scrape/saveHtmlToS3';

// Module-level so every county in the run shares one cap on in-flight listing fetches.
export const LISTING_CONCURRENCY = 8;
const limitListing = createConcurrencyLimiter(LISTING_CONCURRENCY);

export type ListingFieldWarning = FieldWarning & { county: NJCounty; propertyId: number };

export type ScrapeListingResult = { snapshot: ListingSnapshot; warnings: ListingFieldWarning[] };

export type CountyParseSummary = {
  county: NJCounty;
  found: number;
  parsed: number;
  failedListings: number;
  inserted: number;
  updated: number;
  unchanged: number;
  failedWrites: number;
  fieldWarnings: number;
};

/**
 * Fetches and parses a listing's details page into a snapshot dated with the day it's archived under, the same
 * snapshot an archive replay of that page builds. Rejects a page with no recognised layout or no sheriff number, which
 * fails just this listing; any other bad field, a missing address included, is a warning.
 */
export const scrapeListing = async (
  client: NewJerseySheriffSaleHttpClient,
  county: NJCounty,
  propertyId: number,
): Promise<ScrapeListingResult> => {
  const listingDetailsHtml = await getListingDetailsHtml(client, { propertyId });
  const snapshotDate = todaysArchiveDate();

  const page = parseListingSnapshot(listingDetailsHtml);

  if (page.layout === 'unrecognised') {
    throw new Error(`Listing details layout not recognised for propertyId ${propertyId}`);
  }

  const { snapshot, warnings } = buildListingSnapshot({ page, county, propertyId, snapshotDate });

  if (!snapshot.listing.sheriffId) {
    throw new Error(`Listing propertyId ${propertyId} has no sheriff number`);
  }

  return { snapshot, warnings: warnings.map((warning) => ({ ...warning, county, propertyId })) };
};

/** Syncs the listing and its status history in one transaction; see syncListing. */
export const saveListing = async (snapshot: ListingSnapshot): Promise<ListingSyncResult> => {
  const { county, propertyId, sheriffId } = snapshot.listing;

  console.log(`Syncing Listing ${sheriffId} in ${county} County (propertyId ${propertyId}) ...`);
  const result = await syncListing(snapshot);
  console.log(
    `Synced Listing ${sheriffId} in ${county} County: ${result.listing}, ` +
      `${result.statusInserted} status rows inserted, ${result.statusExtended} extended`,
  );

  return result;
};

export const newJerseySheriffSaleCountyParser = async (county: NJCounty): Promise<CountyParseSummary> => {
  console.log(`Parsing ${county} County...`);

  // The site scopes a session to one county, so each county run gets its own client and session.
  const client = new NewJerseySheriffSaleHttpClient();

  const countyListingsHtml = await getCountyListingsHtml(client, county);

  const propertyIds = await parseCountyPropertyIds(countyListingsHtml);

  console.log(`Found ${propertyIds.length} listings in ${county} County`);

  console.log(`Parsing ${propertyIds.length} listings in ${county} County...`);

  const scrapeResults = await Promise.allSettled(
    propertyIds.map((propertyId) => limitListing(() => scrapeListing(client, county, propertyId))),
  );

  const scrapedListings: ListingSnapshot[] = [];
  let fieldWarnings = 0;

  scrapeResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const { snapshot, warnings } = result.value;

      warnings.forEach(({ field, value, reason }) =>
        console.warn(
          `Field warning for listing propertyId ${propertyIds[index]} in ${county} County: ` +
            `${field} ${JSON.stringify(value)} is ${reason}`,
        ),
      );
      fieldWarnings += warnings.length;
      scrapedListings.push(snapshot);
    } else {
      console.error(`Failed to parse listing propertyId ${propertyIds[index]} in ${county} County`, result.reason);
    }
  });

  console.log(`Parsed ${scrapedListings.length} listings in ${county} County`);

  if (propertyIds.length > 0 && scrapedListings.length === 0) {
    throw new Error(`All ${propertyIds.length} listings in ${county} County failed to parse.`);
  }

  const saveResults = await Promise.allSettled(scrapedListings.map((scrapedListing) => saveListing(scrapedListing)));

  const outcomes = { inserted: 0, updated: 0, unchanged: 0 };
  let failedWrites = 0;

  saveResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      outcomes[result.value.listing]++;
    } else {
      failedWrites++;
      console.error(
        `Failed to save listing propertyId ${scrapedListings[index].listing.propertyId} in ${county} County`,
        result.reason,
      );
    }
  });

  if (saveResults.length > 0 && failedWrites === saveResults.length) {
    throw new Error(`All ${saveResults.length} listing writes in ${county} County failed.`);
  }

  // A partial breakage, such as the site serving its home page for most listings, fails the run too; the listings
  // that did parse are written first.
  if (scrapedListings.length < propertyIds.length / 2) {
    throw new Error(
      `Only ${scrapedListings.length} of ${propertyIds.length} listings in ${county} County parsed, fewer than half.`,
    );
  }

  const summary: CountyParseSummary = {
    county,
    found: propertyIds.length,
    parsed: scrapedListings.length,
    failedListings: propertyIds.length - scrapedListings.length,
    ...outcomes,
    failedWrites,
    fieldWarnings,
  };

  console.log(
    `Synced ${county} County: found ${summary.found}, parsed ${summary.parsed}, failed ${summary.failedListings}, ` +
      `inserted ${summary.inserted}, updated ${summary.updated}, unchanged ${summary.unchanged}, ` +
      `failed writes ${summary.failedWrites}, field warnings ${summary.fieldWarnings}`,
  );

  return summary;
};
