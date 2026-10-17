import { describe, expect, it } from 'vite-plus/test';
import { parseAddress } from '../../../shared/address';
import { validateListingDetails } from './listingSchema';
import { parseLegacyListingDetails } from './parseLegacyListingDetails';
import { readFixture } from '../__fixtures__/stubClientAdapter';

const detailRow = (label: string, valueHtml: string) => `
  <tr>
    <td class="heading-bold columnwidth-15">${label}:</td>
    <td>
${valueHtml}                    </td>

    <td class="DetailImageAlign">
    </td>
  </tr>`;

const detailsPage = (...rows: string[]) => `<table class="table table-striped">${rows.join('')}</table>`;

describe('parseLegacyListingDetails', () => {
  it('parses a 2024 legacy page with an approximate upset', () => {
    expect(parseLegacyListingDetails(readFixture('listingDetailsLegacySalem.html'))).toEqual({
      sheriffId: 'F-24000056',
      courtCase: 'F-010586-23',
      saleDate: '07/15/2024 02:00 PM',
      plaintiff: 'PLAINTIFF TRUST PLACEHOLDER, AS OWNER TRUSTEE',
      defendant: 'DEFENDANT NAME; DEFENDANT NAME; State of New Jersey',
      address: '263 Three Bridge Road\nMonroeville NJ 08343',
      description:
        'Approximate Upset $292,458.61. The upset amount may be subject to further Orders of additional sums.',
      upsetAmount: '$275,983.46',
      attorney: 'ATTORNEY FIRM PLACEHOLDER, P.A.',
    });
  });

  it('keeps the street and city apart for parseAddress, as the spec scenario requires', () => {
    const { address } = parseLegacyListingDetails(readFixture('listingDetailsLegacySalem.html'));

    expect(parseAddress(address)).toMatchObject({
      street: '263 Three Bridge Road',
      city: 'Monroeville',
      zipcode: '08343',
    });
  });

  it('parses a legacy page with an approximate judgment, priors, deed fields and a linked address', () => {
    const listing = parseLegacyListingDetails(readFixture('listingDetailsLegacyCumberland.html'));

    expect(listing).toEqual({
      sheriffId: '24000285',
      courtCase: 'F01144923',
      saleDate: '10/23/2024',
      plaintiff: 'PLAINTIFF BANK PLACEHOLDER',
      defendant: 'DEFENDANT NAME ET AL',
      address: '16 YORK STREET\nBRIDGETON NJ 08302',
      priors:
        '5/13/2024 RECEIVED UPDATED UPSET: $37,648.99 Per plf lttr received 6/18/2024 UPDATED UPSET: $40,665.21 ' +
        "to include order for additional sums. Sheriff's File No. 24000285 Notice text placeholder.",
      attorney: 'ATTORNEY FIRM PLACEHOLDER, LLC',
      judgment: '$35,786.09',
      upsetAmount: '$40,665.21',
      deed: '',
      deedAddress: 'LOT 19 BLOCK 101',
    });
    expect(parseAddress(listing.address)).toMatchObject({
      street: '16 York Street',
      city: 'Bridgeton',
      zipcode: '08302',
    });
  });

  it.each(['listingDetailsLegacySalem.html', 'listingDetailsLegacyCumberland.html'])(
    'gives listingSchema only known fields for %s',
    (fixture) => {
      const { details, warnings } = validateListingDetails(parseLegacyListingDetails(readFixture(fixture)));

      expect(warnings).toEqual([]);
      expect(details.sheriffId).toBeTruthy();
    },
  );

  it('maps every legacy label variant to its field', () => {
    const listing = parseLegacyListingDetails(
      detailsPage(
        detailRow('Approx Judgment*', '$1.00'),
        detailRow('Upset Amount', '$2.00'),
        detailRow('Court Case #', 'F-1'),
      ),
    );

    expect(listing).toEqual({ judgment: '$1.00', upsetAmount: '$2.00', courtCase: 'F-1' });
  });

  it('keeps a label that is not a listing field, for listingSchema to warn about', () => {
    const listing = parseLegacyListingDetails(
      detailsPage(detailRow('Sheriff #', 'F-1'), detailRow('Legacy Mystery Field', 'something')),
    );

    expect(listing).toEqual({ sheriffId: 'F-1', legacyMysteryField: 'something' });
  });

  it('decodes entities in values', () => {
    expect(parseLegacyListingDetails(detailsPage(detailRow('Plaintiff', 'A &amp; B BANK')))).toEqual({
      plaintiff: 'A & B BANK',
    });
  });

  it('throws on a page without label cells, such as the home page', () => {
    expect(() => parseLegacyListingDetails(readFixture('home.html'))).toThrow(
      'Legacy listing details layout not recognised',
    );
  });
});
