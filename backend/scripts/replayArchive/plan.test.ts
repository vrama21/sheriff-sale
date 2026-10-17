import { listingPageKey, PASSAIC_ID_FIX_DATE, planCountyDay } from './plan';

describe('planCountyDay', () => {
  it('reads both the gloucester and passaic pages for Gloucester before the fix', () => {
    expect(planCountyDay('2025-05-01', 'Gloucester')).toEqual({
      countyPageKeys: [
        'county-html-files/2025-05-01/gloucester-county.html',
        'county-html-files/2025-05-01/passaic-county.html',
      ],
      syncAs: 'Gloucester',
      skippedPreFix: false,
    });
  });

  it('selects nothing for Passaic before the fix, and says so', () => {
    expect(planCountyDay('2025-05-01', 'Passaic')).toEqual({
      countyPageKeys: [],
      syncAs: 'Passaic',
      skippedPreFix: true,
    });
  });

  it('treats the fix date itself as pre-fix', () => {
    expect(PASSAIC_ID_FIX_DATE).toBe('2026-10-17');
    expect(planCountyDay('2026-10-17', 'Passaic').skippedPreFix).toBe(true);
    expect(planCountyDay('2026-10-17', 'Gloucester').countyPageKeys).toHaveLength(2);
  });

  it('reads the passaic page as Passaic after the fix', () => {
    expect(planCountyDay('2026-10-18', 'Passaic')).toEqual({
      countyPageKeys: ['county-html-files/2026-10-18/passaic-county.html'],
      syncAs: 'Passaic',
      skippedPreFix: false,
    });
  });

  it('reads only the gloucester page for Gloucester after the fix', () => {
    expect(planCountyDay('2026-10-18', 'Gloucester').countyPageKeys).toEqual([
      'county-html-files/2026-10-18/gloucester-county.html',
    ]);
  });

  it('uses the scraper slug for a county with a space', () => {
    expect(planCountyDay('2025-05-01', 'Cape May').countyPageKeys).toEqual([
      'county-html-files/2025-05-01/cape-may-county.html',
    ]);
  });
});

describe('listingPageKey', () => {
  it('builds the detail page key', () => {
    expect(listingPageKey('2024-07-02', 1319120858)).toBe('listing-html-files/2024-07-02/property-id-1319120858.html');
  });
});
