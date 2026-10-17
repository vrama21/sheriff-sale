import { isAxiosError } from 'axios';
import { saveHtmlToS3 } from './saveHtmlToS3';
import { NewJerseySheriffSaleHttpClient } from './newJerseySheriffSaleHttpClient';

export type GetListingDetailsHtmlArgs = {
  propertyId: number;
};

/**
 * Fetches a listing's details page with the client's session, which must belong to the listing's county.
 * Returns and archives the HTML as served.
 */
export const getListingDetailsHtml = async (
  client: NewJerseySheriffSaleHttpClient,
  { propertyId }: GetListingDetailsHtmlArgs,
): Promise<string> => {
  console.log(`Getting html for propertyId ${propertyId}...`);

  let response;
  try {
    // The site redirects to its home page when the session isn't on this listing's county.
    response = await client.get<string>('/Sales/SaleDetails', {
      params: {
        PropertyId: propertyId.toString(),
      },
      maxRedirects: 0,
    });
  } catch (error) {
    const errorResponse = isAxiosError(error) ? error.response : undefined;

    if (errorResponse && errorResponse.status >= 300 && errorResponse.status < 400) {
      const location = errorResponse.headers['location'] ?? '(no location)';

      throw new Error(`Session rejected for propertyId ${propertyId}: redirected to ${location}`, { cause: error });
    }

    throw error;
  }

  if (typeof response.data !== 'string' || !response.data) {
    throw new Error(`Empty listing details response for propertyId ${propertyId} (status ${response.status})`);
  }

  const html = response.data;

  // Archived before parsing so unparseable HTML is still kept; the archive is best-effort.
  try {
    await saveHtmlToS3({ html, keyPrefix: 'listing-html-files', keySuffix: `property-id-${propertyId}.html` });
  } catch (error) {
    console.error(`Failed to save html for propertyId ${propertyId} to S3`, error);
  }

  return html;
};
