import { parseListingDetails } from './parseListingDetails';
import { readFixture } from './__fixtures__/stubClientAdapter';

const detailItem = (label: string, valueHtml: string) => `
  <div class="sale-detail-item">
    <div class="sale-detail-label">${label}&colon;</div>
    <div class="sale-detail-value">
${valueHtml}                        </div>
    <div class="sale-detail-image DetailImageAlign"></div>
  </div>`;

const detailsPage = (...items: string[]) => `<div class="sale-details-list">${items.join('')}</div>`;

describe('parseListingDetails', () => {
  it('parses a details page with a mixed-case address and an upset amount', () => {
    expect(parseListingDetails(readFixture('listingDetailsPassaic.html'))).toEqual({
      sheriffId: 'F-23001318',
      courtCase: 'F 013571 15 CTL#162552',
      saleDate: '10/20/2026',
      plaintiff: 'PLAINTIFF BANK, N.A. & TRUSTEE',
      defendant: 'DEFENDANT NAME, ET ALS.',
      address: '8 Floyd Drive\nTotowa NJ 07512',
      description:
        "SUPERIOR COURT OF NEW JERSEY PASSAIC COUNTY SUPERIOR COURT SHERIFF'S SALE NO. 23001318 " +
        'Notice text placeholder. PREMISES COMMONLY KNOWN AS: 8 Floyd Drive Totowa, NJ 07512 ' +
        'ATTORNEY FIRM PLACEHOLDER 1 Placeholder Road Placeholder, NJ 00000',
      upsetAmount: '$813,074.58',
      attorney: 'ATTORNEY FIRM PLACEHOLDER, LLC',
      parcel: 'Tax Lot: 21.11 (Formerly Lot 21-K) in Block: 173',
      propertyNote: '',
    });
  });

  it('stores an approximate judgment as judgment, for a page with an upper-case address', () => {
    expect(parseListingDetails(readFixture('listingDetailsGloucester.html'))).toEqual({
      sheriffId: 'F-24000351',
      courtCase: 'F-023514-18',
      saleDate: '1/28/2028',
      plaintiff: 'PLAINTIFF TRUST COMPANY, AS TRUSTEE',
      defendant: 'DEFENDANT NAME, ET AL',
      address: '40 ROSEBERRY COURT\nDEPTFORD NJ 08096',
      description: 'PUBLIC NOTICE SHERIFF’S SALE Notice text placeholder.',
      attorney: 'ATTORNEY FIRM PLACEHOLDER, P.C.',
      judgment: '$258,635.93',
      parcel: 'BLOCK: 127 LOT: 40',
      propertyNote: '',
    });
  });

  it('keys a label that is not a listing field by its camelCase name, for listingSchema to drop', () => {
    const listing = parseListingDetails(
      detailsPage(
        detailItem('Sheriff #', 'F-1'),
        detailItem('Mystery Field', 'something'),
        detailItem('Address', '1 MAIN STREET<br/>TRENTON NJ 08608'),
      ),
    );

    expect(listing).toEqual({
      sheriffId: 'F-1',
      mysteryField: 'something',
      address: '1 MAIN STREET\nTRENTON NJ 08608',
    });
  });

  it('decodes entities in values without turning them into markup', () => {
    const listing = parseListingDetails(detailsPage(detailItem('Plaintiff', 'A &lt;b&gt;BANK&lt;/b&gt; &amp; CO')));

    expect(listing).toEqual({ plaintiff: 'A <b>BANK</b> & CO' });
  });

  it('throws on a page without the details layout, such as the home page a rejected session redirects to', () => {
    expect(() => parseListingDetails(readFixture('home.html'))).toThrow('Listing details layout not recognised');
  });
});
