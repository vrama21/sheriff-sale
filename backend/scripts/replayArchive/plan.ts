import { countySlug } from '../../src/services/newJerseySheriffSale/countySlug';
import { NJCounty } from '../../src/types';

/**
 * Until adapt-scraper-to-civilview (#19) deployed, the scraper fetched Passaic with Gloucester's county ID, so the
 * archived `passaic` county page lists Gloucester sales. The 2026-10-17 run (00:00 UTC) predates #19's merge at
 * 06:46 UTC, so that day is still pre-fix.
 */
export const PASSAIC_ID_FIX_DATE = '2026-10-17';

export interface CountyDayPlan {
  /** The county page keys to read for the requested county, in reading order. */
  countyPageKeys: string[];
  /** The county every listing on those pages is synced under. */
  syncAs: NJCounty;
  /** Set when the requested county has no pages of its own that day (Passaic before the fix). */
  skippedPreFix: boolean;
}

export const countyPageKey = (date: string, slug: string) => `county-html-files/${date}/${slug}-county.html`;

export const listingPageKey = (date: string, propertyId: number) =>
  `listing-html-files/${date}/property-id-${propertyId}.html`;

/** Which archived county pages hold the requested county's listings on `date` (YYYY-MM-DD). */
export const planCountyDay = (date: string, county: NJCounty): CountyDayPlan => {
  const preFix = date <= PASSAIC_ID_FIX_DATE;

  if (preFix && county === 'Passaic') {
    return { countyPageKeys: [], syncAs: county, skippedPreFix: true };
  }

  if (preFix && county === 'Gloucester') {
    return {
      countyPageKeys: [countyPageKey(date, countySlug('Gloucester')), countyPageKey(date, countySlug('Passaic'))],
      syncAs: county,
      skippedPreFix: false,
    };
  }

  return { countyPageKeys: [countyPageKey(date, countySlug(county))], syncAs: county, skippedPreFix: false };
};
