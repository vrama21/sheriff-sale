import { cleanAddress } from './cleanAddress';
import { getCountyListingsHtml } from './getCountyListingsHtml';
import { getListingDetailsHtml } from './getListingDetailsHtml';
import { validateListingDetails, validateStatusHistory } from './listingSchema';
import { parseCountyProperyIds } from './parseCountyProperyIds';
import { parseLegacyListingDetails } from './parseLegacyListingDetails';
import { parseListingDetails } from './parseListingDetails';
import { detectListingLayout, parseListingSnapshot } from './parseListingSnapshot';
import { parseStatusHistory } from './parseStatusHistory';
import { saveHtmlToS3 } from './saveHtmlToS3';

export const newJerseySheriffSaleService = {
  cleanAddress,
  detectListingLayout,
  getCountyListingsHtml,
  getListingDetailsHtml,
  parseCountyProperyIds,
  parseLegacyListingDetails,
  parseListingDetails,
  parseListingSnapshot,
  parseStatusHistory,
  saveHtmlToS3,
  validateListingDetails,
  validateStatusHistory,
};

export type { FieldWarning } from './listingSchema';
export * from './newJerseySheriffSaleHttpClient';
export type { ListingLayout, ParsedListingSnapshot } from './parseListingSnapshot';
