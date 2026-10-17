import { cleanAddress } from './cleanAddress';
import { getCountyListingsHtml } from './getCountyListingsHtml';
import { getListingDetailsHtml } from './getListingDetailsHtml';
import { validateListingDetails, validateStatusHistory } from './listingSchema';
import { parseCountyProperyIds } from './parseCountyProperyIds';
import { parseListingDetails } from './parseListingDetails';
import { parseStatusHistory } from './parseStatusHistory';
import { saveHtmlToS3 } from './saveHtmlToS3';

export const newJerseySheriffSaleService = {
  cleanAddress,
  getCountyListingsHtml,
  getListingDetailsHtml,
  parseCountyProperyIds,
  parseListingDetails,
  parseStatusHistory,
  saveHtmlToS3,
  validateListingDetails,
  validateStatusHistory,
};

export type { FieldWarning } from './listingSchema';
export * from './newJerseySheriffSaleHttpClient';
