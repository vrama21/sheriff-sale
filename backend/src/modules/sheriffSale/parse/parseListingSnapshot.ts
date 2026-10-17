import { parse } from 'node-html-parser';
import { RawStatusRow } from './listingSchema';
import { parseLegacyListingDetails } from './parseLegacyListingDetails';
import { parseListingDetails } from './parseListingDetails';
import { parseStatusHistory } from './parseStatusHistory';

/**
 * `current`: `.sale-detail-item` elements, served from 2025-02-26. `legacy`: the older table of `td.heading-bold`
 * label cells. `unrecognised`: anything else, such as the home page a rejected session was redirected to.
 */
export type ListingLayout = 'current' | 'legacy' | 'unrecognised';

/** A details page's raw text, before it's validated and tied to a county and a day. */
export type ParsedListingPage = {
  listing: Record<string, string>;
  statusHistory: RawStatusRow[];
};

export type ParsedListingSnapshot = ({ layout: 'current' | 'legacy' } & ParsedListingPage) | { layout: 'unrecognised' };

export const detectListingLayout = (html: string): ListingLayout => {
  const root = parse(html);

  if (root.querySelector('.sale-detail-item')) {
    return 'current';
  }

  if (root.querySelector('td.heading-bold')) {
    return 'legacy';
  }

  return 'unrecognised';
};

/**
 * Parses a details page with the parser for its layout. Both layouts keep their status history in the same
 * table. Returns `{ layout: 'unrecognised' }` rather than throwing for a page with neither layout; throws when
 * a recognised page fails to parse.
 */
export const parseListingSnapshot = (html: string): ParsedListingSnapshot => {
  const layout = detectListingLayout(html);

  if (layout === 'unrecognised') {
    return { layout };
  }

  const listing = layout === 'current' ? parseListingDetails(html) : parseLegacyListingDetails(html);

  return { layout, listing, statusHistory: parseStatusHistory(html) };
};
