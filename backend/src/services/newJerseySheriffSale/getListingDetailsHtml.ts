import * as he from 'he';
import { saveHtmlToS3 } from './saveHtmlToS3';
import { NewJerseySheriffSaleHttpClient } from './newJerseySheriffSaleHttpClient';

export type GetListingDetailsHtmlArgs = {
  propertyId: number;
};

export const getListingDetailsHtml = async ({ propertyId }: GetListingDetailsHtmlArgs): Promise<string> => {
  const njSheriffSaleClient = NewJerseySheriffSaleHttpClient.getClient();

  console.log(`Getting html for propertyId ${propertyId}...`);
  const response = await njSheriffSaleClient.get<string>('/Sales/SaleDetails', {
    params: {
      PropertyId: propertyId.toString(),
    },
  });

  if (typeof response.data !== 'string' || !response.data) {
    throw new Error(`Empty listing details response for propertyId ${propertyId} (status ${response.status})`);
  }

  const html = he.decode(response.data);

  // Archived before parsing so unparseable HTML is still kept; the archive is best-effort.
  try {
    await saveHtmlToS3({ html, keyPrefix: 'listing-html-files', keySuffix: `property-id-${propertyId}.html` });
  } catch (error) {
    console.error(`Failed to save html for propertyId ${propertyId} to S3`, error);
  }

  return html;
};
