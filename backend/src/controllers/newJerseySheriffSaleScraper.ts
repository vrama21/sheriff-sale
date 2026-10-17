import { ListingParse, NJCounty, StatusHistoryParse } from '../types';
import { db, listings, statusHistories } from '@sheriff-sale/database';
import { newJerseySheriffSaleService } from '../services/newJerseySheriffSale';
import { createConcurrencyLimiter } from '../utils';

// Module-level so every county in the run shares one cap on in-flight listing fetches.
export const LISTING_CONCURRENCY = 8;
const limitListing = createConcurrencyLimiter(LISTING_CONCURRENCY);

export type ScrapedListing = {
  listing: ListingParse;
  statusHistory: StatusHistoryParse[];
};

export type CountyParseSummary = {
  county: NJCounty;
  found: number;
  parsed: number;
  failedListings: number;
  inserted: number;
  failedWrites: number;
};

export const scrapeListing = async (county: NJCounty, propertyId: number): Promise<ScrapedListing> => {
  const listingDetailsHtml = await newJerseySheriffSaleService.getListingDetailsHtml({ propertyId });

  const listingDetails = newJerseySheriffSaleService.parseListingDetails(listingDetailsHtml);
  const statusHistory = newJerseySheriffSaleService.parseStatusHistory(listingDetailsHtml);
  const cleanedAddress = newJerseySheriffSaleService.cleanAddress(listingDetails.address as string);

  const listing: ListingParse = {
    ...listingDetails,
    ...cleanedAddress,
    county,
    propertyId,
    state: 'NJ',
  };

  return { listing, statusHistory };
};

/**
 * Inserts the listing and its status histories unless the listing is already in the DB.
 * Resolves true when it inserted, false when the listing already existed.
 */
export const saveListing = async ({
  listing: parsedListing,
  statusHistory: parsedStatusHistories,
}: ScrapedListing): Promise<boolean> => {
  const listingInDB = await db.query.listings.findFirst({
    where: (listings, { eq }) => eq(listings.propertyId, parsedListing.propertyId as number),
  });

  if (listingInDB) {
    return false;
  }

  // One transaction, so a failed status-history insert rolls back the listing too. Otherwise the next run
  // would find the listing, skip it, and never write its histories.
  await db.transaction(async (tx) => {
    console.log(`Inserting Listing propertyId ${parsedListing.propertyId} and address ${parsedListing.address} ...`);
    const [newListing] = await tx
      .insert(listings)
      .values({ ...parsedListing })
      .returning();
    console.log(`Inserted Listing ${newListing.id}`);

    console.log(`Found ${parsedStatusHistories.length} Status Histories for Listing ${newListing.id} ...`);
    for (const parsedStatusHistory of parsedStatusHistories) {
      console.log(`Inserting Status History for listing ${newListing.id} ...`);
      const [newStatusHistory] = await tx
        .insert(statusHistories)
        .values({
          ...parsedStatusHistory,
          listingId: newListing.id,
        })
        .onConflictDoNothing()
        .returning();
      console.log(`Inserted Status History ${newStatusHistory?.id} for listing ${newListing.id}`);
    }
  });

  return true;
};

export const newJerseySheriffSaleCountyParser = async (county: NJCounty): Promise<CountyParseSummary> => {
  console.log(`Parsing ${county} County...`);

  const countyListingsHtml = await newJerseySheriffSaleService.getCountyListingsHtml(county);

  const propertyIds = await newJerseySheriffSaleService.parseCountyProperyIds(countyListingsHtml);

  console.log(`Found ${propertyIds.length} listings in ${county} County`);

  console.log(`Parsing ${propertyIds.length} listings in ${county} County...`);

  const scrapeResults = await Promise.allSettled(
    propertyIds.map((propertyId) => limitListing(() => scrapeListing(county, propertyId))),
  );

  const scrapedListings: ScrapedListing[] = [];

  scrapeResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      scrapedListings.push(result.value);
    } else {
      console.error(`Failed to parse listing propertyId ${propertyIds[index]} in ${county} County`, result.reason);
    }
  });

  console.log(`Parsed ${scrapedListings.length} listings in ${county} County`);

  if (propertyIds.length > 0 && scrapedListings.length === 0) {
    throw new Error(`All ${propertyIds.length} listings in ${county} County failed to parse.`);
  }

  const saveResults = await Promise.allSettled(scrapedListings.map((scrapedListing) => saveListing(scrapedListing)));

  let inserted = 0;
  let failedWrites = 0;

  saveResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      inserted += result.value ? 1 : 0;
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
    inserted,
    failedWrites,
  };

  console.log(
    `Parsed ${inserted} new listings for ${county} County successfully! ` +
      `(found ${summary.found}, parsed ${summary.parsed}, failed ${summary.failedListings}, ` +
      `inserted ${summary.inserted}, failed writes ${summary.failedWrites})`,
  );

  return summary;
};
