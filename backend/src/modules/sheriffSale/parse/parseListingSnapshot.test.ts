import { detectListingLayout, parseListingSnapshot } from './parseListingSnapshot';
import { readFixture } from '../__fixtures__/stubClientAdapter';

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('detectListingLayout', () => {
  it.each([
    ['listingDetailsPassaic.html', 'current'],
    ['listingDetailsGloucester.html', 'current'],
    ['listingDetailsLegacySalem.html', 'legacy'],
    ['listingDetailsLegacyCumberland.html', 'legacy'],
    ['home.html', 'unrecognised'],
    ['countyListingsPassaic.html', 'unrecognised'],
  ])('detects %s as %s', (fixture, layout) => {
    expect(detectListingLayout(readFixture(fixture))).toBe(layout);
  });

  it('treats an empty page as unrecognised', () => {
    expect(detectListingLayout('')).toBe('unrecognised');
  });
});

describe('parseListingSnapshot', () => {
  it('parses a current-layout page with the current parser', () => {
    const parsed = parseListingSnapshot(readFixture('listingDetailsPassaic.html'));

    expect(parsed).toMatchObject({ layout: 'current', listing: { sheriffId: 'F-23001318' } });
  });

  it('parses a legacy page with the legacy parser and reads its status history', () => {
    expect(parseListingSnapshot(readFixture('listingDetailsLegacySalem.html'))).toMatchObject({
      layout: 'legacy',
      listing: { sheriffId: 'F-24000056', upsetAmount: '$275,983.46' },
      statusHistory: [
        { status: 'Scheduled', date: '05/20/2024 02:00 PM' },
        { status: 'Adjourned - Defendant', date: '06/17/2024 02:00 PM' },
        { status: 'Adjourned - Defendant', date: '07/15/2024 02:00 PM' },
      ],
    });
  });

  it('returns unrecognised for the home page without throwing', () => {
    expect(parseListingSnapshot(readFixture('home.html'))).toEqual({ layout: 'unrecognised' });
  });

  it('throws when a recognised page has no status history table', () => {
    expect(() =>
      parseListingSnapshot('<table><tr><td class="heading-bold">Sheriff #:</td><td>F-1</td></tr></table>'),
    ).toThrow('Status history layout not recognised');
  });
});
