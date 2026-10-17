import { NJCounty } from '../../../shared/nj';
import { NJSheriffSaleCountyIdMap } from './njSheriffSaleCountyIdMap';
import { countySlug } from './countySlug';
import { saveHtmlToS3 } from './saveHtmlToS3';
import { NewJerseySheriffSaleHttpClient } from './newJerseySheriffSaleHttpClient';

/**
 * Searches the county's listings, which also points the client's session at this county.
 * Returns and archives the HTML as served.
 */
export const getCountyListingsHtml = async (
  client: NewJerseySheriffSaleHttpClient,
  county: NJCounty,
): Promise<string> => {
  const countyId = NJSheriffSaleCountyIdMap[county];

  console.log(`Getting html for ${county} county...`);
  const response = await client.get<string>('Sales/SalesSearch', {
    params: {
      countyId,
    },
  });
  console.log(`Got html for ${county} county`);

  if (typeof response.data !== 'string' || !response.data) {
    throw new Error(`Empty county listings response for ${county} County (status ${response.status})`);
  }

  const html = response.data;

  try {
    await saveHtmlToS3({ html, keyPrefix: 'county-html-files', keySuffix: `${countySlug(county)}-county.html` });
  } catch (error) {
    console.error(`Failed to save html for ${county} County to S3`, error);
  }

  return html;
};
