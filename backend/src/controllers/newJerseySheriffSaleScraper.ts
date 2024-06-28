import { ListingParse, NJCounty } from '../types';
import { db, listings, statusHistories } from '@sheriff-sale/database';
import { newJerseySheriffSaleService } from '../services/newJerseySheriffSale';

export const newJerseySheriffSaleCountyParser = async (county: NJCounty): Promise<void> => {
  console.log(`Parsing ${county} County...`);

  const countyListingsHtml = await newJerseySheriffSaleService.getCountyListingsHtml(county);

  const propertyIds = await newJerseySheriffSaleService.parseCountyProperyIds(countyListingsHtml);

  console.log(`Found ${propertyIds.length} listings in ${county} County`);

  console.log(`Parsing ${propertyIds.length} listings in ${county} County...`);

  const mappedListings = await Promise.all(
    propertyIds.map(async (propertyId) => {
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
    }),
  );

  console.log(`Parsed ${mappedListings.length} listings in ${county} County`);

  const promiseResults = await Promise.allSettled(
    mappedListings.map(async ({ listing: parsedListing, statusHistory: parsedStatusHistories }) => {
      const listingInDB = await db.query.listings.findFirst({
        where: (listings, { eq }) => eq(listings.propertyId, parsedListing.propertyId as number),
      });

      if (!listingInDB) {
        console.log(
          `Inserting Listing propertyId ${parsedListing.propertyId} and address ${parsedListing.address} ...`,
        );
        const [newListing] = await db
          .insert(listings)
          .values({ ...parsedListing })
          .returning();
        console.log(`Inserted Listing ${newListing.id}`);

        console.log(`Found ${parsedStatusHistories.length} Status Histories for Listing ${newListing.id} ...`);
        await Promise.all(
          parsedStatusHistories.map(async (parsedStatusHistory) => {
            console.log(`Inserting Status History for listing ${newListing.id} ...`);
            const [newStatusHistory] = await db
              .insert(statusHistories)
              .values({
                ...parsedStatusHistory,
                listingId: newListing.id,
              })
              .onConflictDoNothing()
              .returning();
            console.log(`Inserted Status History ${newStatusHistory.id} for listing ${newListing.id}`);
          }),
        );
      }
    }),
  );

  promiseResults.forEach((result) => {
    if (result.status === 'rejected') {
      console.error(result.reason);
    }
  });

  console.log(
    `Parsed ${
      promiseResults.filter((result) => result.status === 'fulfilled').length
    } new listings for ${county} County successfully!`,
  );
};

void newJerseySheriffSaleCountyParser('Atlantic').then(() => {
  process.exit(0);
});
