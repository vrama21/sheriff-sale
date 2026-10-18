import { describe, expect, it } from 'vite-plus/test';
import { joinNoticeOverflow, MAX_PARCEL_LENGTH, MIN_CAPPED_DESCRIPTION_LENGTH } from './joinNoticeOverflow';
import { parseListingDetails } from './parseListingDetails';
import { readFixture } from '../__fixtures__/stubClientAdapter';

const cappedDescription = 'NOTICE '.repeat(300).trim();
const spilledParcel = 'MORE NOTICE '.repeat(30).trim();

describe('joinNoticeOverflow', () => {
  it('joins a Burlington notice split across Description, Parcel # and Property Note back into the description', () => {
    const parsed = parseListingDetails(readFixture('listingDetailsBurlingtonOverflow.html'));
    const listing = joinNoticeOverflow(parsed);

    expect(listing.description).toBe(`${parsed.description} ${parsed.parcel} ${parsed.propertyNote}`);
    expect(listing.description).toMatch(/^APPROXIMATE GOOD FAITH ESTIMATE OF UPSET PRICE: \$174,055\.95 /);
    expect(listing.description).toContain(
      'BEING KNOWN AS LOT 6.02 BLOCK 303 ON THE OFFICIAL TAX MAP OF THE TOWNSHIP OF CINNAMINSON',
    );
    expect(listing.description).toContain(
      'satisfaction of the mortgage debt, including costs and expenses, there remains any surplus money',
    );
    expect(listing.description).toContain('AN INSTITUTION REGULATED BY THE DEPARTMENT OF BANKING AND INSURANCE');
    expect(listing.description).toMatch(/ Attorney \(s\): 555 555-0100$/);
    expect(listing).not.toHaveProperty('parcel');
    expect(listing).not.toHaveProperty('propertyNote');
    expect(listing).toMatchObject({ sheriffId: '26001077', courtCase: 'F-009252-25' });
  });

  it.each(['listingDetailsPassaic.html', 'listingDetailsGloucester.html'])('leaves %s unchanged', (fixture) => {
    const parsed = parseListingDetails(readFixture(fixture));

    expect(joinNoticeOverflow(parsed)).toBe(parsed);
  });

  it('leaves a parcel of normal length next to a description at the cap unchanged', () => {
    const listing = { description: cappedDescription, parcel: 'BLOCK 303 LOT 6.02', propertyNote: 'A note' };

    expect(joinNoticeOverflow(listing)).toBe(listing);
  });

  it('leaves a long parcel next to a description well short of the cap unchanged', () => {
    const listing = { description: 'PUBLIC NOTICE SHERIFF’S SALE', parcel: spilledParcel };

    expect(joinNoticeOverflow(listing)).toBe(listing);
  });

  it('leaves a parcel of exactly the longest real length unchanged', () => {
    const listing = { description: cappedDescription, parcel: 'X'.repeat(MAX_PARCEL_LENGTH) };

    expect(joinNoticeOverflow(listing)).toBe(listing);
  });

  it('joins a notice that ended in the parcel, with an empty property note, without a trailing space', () => {
    const description = 'D'.repeat(MIN_CAPPED_DESCRIPTION_LENGTH);

    expect(joinNoticeOverflow({ sheriffId: 'F-1', description, parcel: spilledParcel, propertyNote: '' })).toEqual({
      sheriffId: 'F-1',
      description: `${description} ${spilledParcel}`,
    });
  });
});
