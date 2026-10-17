import { NJCounty } from '../types';
import { buildListingSnapshot, ListingSnapshot, ListingSyncResult, syncListing } from '../services/listingSync';
import {
  FieldWarning,
  NewJerseySheriffSaleHttpClient,
  newJerseySheriffSaleService,
} from '../services/newJerseySheriffSale';
import { todaysArchiveDate } from '../services/newJerseySheriffSale/saveHtmlToS3';
import { createConcurrencyLimiter } from '../utils';

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
 * snapshot an archive replay of that page builds. Rejects a page with no recognised layout, no address or no sheriff
 * number, which fails just this listing; any other bad field is a warning.
 */
export const scrapeListing = async (
  client: NewJerseySheriffSaleHttpClient,
  county: NJCounty,
  propertyId: number,
): Promise<ScrapeListingResult> => {
  const listingDetailsHtml = await newJerseySheriffSaleService.getListingDetailsHtml(client, { propertyId });
  const snapshotDate = todaysArchiveDate();

  const page = newJerseySheriffSaleService.parseListingSnapshot(listingDetailsHtml);

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

  const countyListingsHtml = await newJerseySheriffSaleService.getCountyListingsHtml(client, county);

  const propertyIds = await newJerseySheriffSaleService.parseCountyProperyIds(countyListingsHtml);

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
