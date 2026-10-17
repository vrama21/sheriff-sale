import * as he from 'he';
import { NJCounty, NJSheriffSaleCountyIdMap } from '../../types';
import { saveHtmlToS3 } from './saveHtmlToS3';
import { NewJerseySheriffSaleHttpClient } from './newJerseySheriffSaleHttpClient';

export const getCountyListingsHtml = async (county: NJCounty): Promise<string> => {
  const njSheriffSaleClient = NewJerseySheriffSaleHttpClient.getClient();

  const countyId = NJSheriffSaleCountyIdMap[county];

  console.log(`Getting html for ${county} county...`);
  const response = await njSheriffSaleClient.get<string>('Sales/SalesSearch', {
    params: {
      countyId,
    },
  });
  console.log(`Got html for ${county} county`);

  if (typeof response.data !== 'string' || !response.data) {
    throw new Error(`Empty county listings response for ${county} County (status ${response.status})`);
  }

  const html = he.decode(response.data);

  try {
    await saveHtmlToS3({ html, keyPrefix: 'county-html-files', keySuffix: `${county.toLowerCase()}-county.html` });
  } catch (error) {
    console.error(`Failed to save html for ${county} County to S3`, error);
  }

  return html;
};
