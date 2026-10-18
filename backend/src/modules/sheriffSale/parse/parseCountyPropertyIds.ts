import { parse } from 'node-html-parser';

export const parseCountyPropertyIds = async (countyListingHtml: string): Promise<number[]> => {
  const root = parse(countyListingHtml);

  const listingsTableDiv = root.querySelectorAll('table').at(-1);

  if (!listingsTableDiv) {
    throw new Error('County listings layout not recognised: no listings table');
  }

  const listingTableRows = listingsTableDiv.querySelectorAll('tr').slice(1);

  const propertyIds = listingTableRows.map((listingTableRow) => {
    // A row without a details link has no property ID.
    const listingHref = listingTableRow.querySelector('td')?.querySelector('a')?.getAttribute('href');

    const propertyId = listingHref?.match(/\d+/)?.[0];

    if (propertyId) {
      return Number(propertyId);
    }

    return undefined;
  });

  return propertyIds.filter((propertyId): propertyId is number => propertyId !== undefined);
};
