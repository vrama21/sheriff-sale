import { describe, expect, it } from 'vite-plus/test';
import { DateTime } from 'luxon';
import { parseAddress } from '../../../shared/address';
import { joinNoticeOverflow } from './joinNoticeOverflow';
import { validateListingDetails, validateStatusHistory } from './listingSchema';
import { parseListingDetails } from './parseListingDetails';
import { parseStatusHistory } from './parseStatusHistory';
import { readFixture } from '../__fixtures__/stubClientAdapter';

const ADDRESS = '1 MAIN STREET\nTRENTON NJ 08608';

const validate = (fields: Record<string, string>) => validateListingDetails({ address: ADDRESS, ...fields });

describe('validateListingDetails', () => {
  it('validates a parsed details page without warnings', () => {
    const { details, warnings } = validateListingDetails(
      parseListingDetails(readFixture('listingDetailsPassaic.html')),
    );

    expect(warnings).toEqual([]);
    expect(details).toMatchObject({
      address: '8 Floyd Drive\nTotowa NJ 07512',
      sheriffId: 'F-23001318',
      saleDate: '2026-10-20',
      upsetAmount: 813074.58,
      judgment: null,
    });
    expect(details).not.toHaveProperty('propertyNote');
  });

  it('sets every listing field, null when the page left it out', () => {
    expect(validate({ upsetAmount: '$1,585.95' })).toEqual({
      details: {
        address: ADDRESS,
        attorney: null,
        attorneyPhone: null,
        courtCase: null,
        deed: null,
        deedAddress: null,
        defendant: null,
        description: null,
        judgment: null,
        parcel: null,
        plaintiff: null,
        priors: null,
        saleDate: null,
        sheriffId: null,
        upsetAmount: 1585.95,
      },
      warnings: [],
    });
  });

  describe('address', () => {
    it.each([
      ['missing', { sheriffId: 'F-4127' }, ''],
      ['whitespace-only', { sheriffId: 'F-4127', address: '\r  \n   ' }, '\r  \n   '],
    ])('stores a %s address as null with a warning, and keeps the other fields', (_case, raw, value) => {
      expect(validateListingDetails(raw)).toMatchObject({
        details: { address: null, sheriffId: 'F-4127' },
        warnings: [{ field: 'address', value, reason: 'missing or blank' }],
      });
    });

    it('keeps the street / city line break for parseAddress, and parseAddress stores the address on one line', () => {
      const { details } = validateListingDetails({ address: '  40-42  MYRTLE STREET\r\n  BRIDGETON NJ   08302 ' });

      expect(details.address).toBe('40-42 MYRTLE STREET\nBRIDGETON NJ 08302');
      expect(parseAddress(details.address)).toMatchObject({
        address: '40-42 MYRTLE STREET BRIDGETON NJ 08302',
        street: '40-42 Myrtle Street',
        city: 'Bridgeton',
        zipcode: '08302',
      });
    });
  });

  describe('money', () => {
    it.each([
      ['$1,585.95', 1585.95],
      ['\r $1,585.95                    ', 1585.95],
      ['\r $1,002,812.05                    ', 1002812.05],
      ['1,585.95', 1585.95],
      ['$813,074', 813074],
      ['$0.00', 0],
    ])('coerces %j to %j', (value, expected) => {
      expect(validate({ upsetAmount: value, judgment: value })).toMatchObject({
        details: { upsetAmount: expected, judgment: expected },
        warnings: [],
      });
    });

    it.each(['', '\r                     ', '   '])('stores %j as null without a warning', (value) => {
      expect(validate({ upsetAmount: value })).toMatchObject({ details: { upsetAmount: null }, warnings: [] });
    });

    it.each(['TBD', '$1,585.955', '-$5.00', '$1.585,95', '2024 TAXES $5,000.00'])(
      'stores %j as null with a warning',
      (value) => {
        expect(validate({ upsetAmount: value })).toMatchObject({
          details: { upsetAmount: null },
          warnings: [{ field: 'upsetAmount', value, reason: 'not a dollar amount' }],
        });
      },
    );

    it.each([
      ['$384,211.73 GOOD THROUGH JULY 19, 2024, AND ANY ADDITIONAL SUMS AS ORDERED BY THE COURT.', 384211.73],
      ['$786,559.65.', 786559.65],
      ['$784,000.00 LOT:3 FKA 10.A BLOCK: 13301 FKA 1837.5', 784000],
      ['$195,000.00, PLUS ANY ADDITIONAL SUMS AS ORDERED BY THE COURT.', 195000],
      ['1,668,737.41 TOGETHER WITH COST OF THE SALE', 1668737.41],
    ])('keeps the leading amount of %j, %j, with a warning naming the full value', (value, expected) => {
      expect(validate({ upsetAmount: value, judgment: value })).toMatchObject({
        details: { upsetAmount: expected, judgment: expected },
        warnings: [
          { field: 'judgment', value, reason: expect.stringContaining('followed by other text') },
          { field: 'upsetAmount', value, reason: expect.stringContaining('followed by other text') },
        ],
      });
    });

    it('doesn’t look for an upset figure in a judgment that isn’t an amount', () => {
      expect(validate({ judgment: 'ESTIMATED UPSET BID AMOUNT: $224,000.00' })).toMatchObject({
        details: { judgment: null },
        warnings: [{ field: 'judgment', reason: 'not a dollar amount' }],
      });
    });
  });

  describe('upset amount from free text', () => {
    const validateFixture = (fixture: string) =>
      validateListingDetails(joinNoticeOverflow(parseListingDetails(readFixture(fixture))));

    it.each([
      ['Hunterdon', 'listingDetailsHunterdon.html', 201700, 'Property Details, without a $'],
      ['Burlington', 'listingDetailsBurlington.html', 143198, 'Description'],
      ['Gloucester', 'listingDetailsGloucesterUpset.html', 251897.98, 'Property Note, before Description'],
      ['Middlesex', 'listingDetailsMiddlesex.html', 377000, 'Property Note, with a blank Minimum Bid'],
    ])('takes a %s page’s upset amount from %s (%s)', (_county, fixture, upsetAmount) => {
      const { details, warnings } = validateFixture(fixture);

      expect(details.upsetAmount).toBe(upsetAmount);
      expect(warnings.map(({ field }) => field)).not.toContain('upsetAmount');
      expect(warnings.map(({ field }) => field)).not.toContain('propertyDetails');
      expect(warnings.map(({ field }) => field)).not.toContain('attorneyFile');
    });

    it('takes Cape May’s Minimum Bid over the upset price in its Description', () => {
      expect(validateFixture('listingDetailsCapeMay.html').details).toMatchObject({
        address: '15 OSPREY Drive\nNorth Cape May NJ 08204',
        upsetAmount: 380000,
        judgment: 341563.55,
      });
    });

    it('reads Property Details first', () => {
      expect(
        validate({
          propertyDetails: 'APPROX. UPSET: $1,108,438.48',
          propertyNote: 'UPSET PRICE: $2.00',
          description: 'UPSET PRICE: $3.00',
        }),
      ).toEqual(
        expect.objectContaining({ details: expect.objectContaining({ upsetAmount: 1108438.48 }), warnings: [] }),
      );
    });

    it('keeps the upset row over an upset price in the Description', () => {
      expect(
        validate({ upsetAmount: '$41,000.00', description: 'The approximate upset price is $45,000.00.' }).details
          .upsetAmount,
      ).toBe(41000);
    });

    describe('an upset row that isn’t an amount', () => {
      const UPSET_ROW = 'ESTIMATED UPSET BID AMOUNT: $224,000.00, PLUS ANY ADDITIONAL SUMS AS ORDERED BY THE COURT.';
      const keptFigure = { field: 'upsetAmount', value: UPSET_ROW, reason: expect.stringContaining('figure') };

      it('takes the figure after its own upset phrase, with a warning, when the Description doesn’t repeat it', () => {
        const { description, ...raw } = parseListingDetails(readFixture('listingDetailsHudsonUpsetText.html'));

        expect(description).toContain(UPSET_ROW);
        expect(raw.upsetAmount).toBe(UPSET_ROW);
        expect(validateListingDetails(raw)).toMatchObject({
          details: { sheriffId: '20054473', upsetAmount: 224000, judgment: 204422.17, description: null },
          warnings: [keptFigure],
        });
      });

      it('takes the figure for the whole archived page', () => {
        expect(validateFixture('listingDetailsHudsonUpsetText.html')).toMatchObject({
          details: { upsetAmount: 224000 },
          warnings: [keptFigure],
        });
      });

      it('takes its own figure over an upset price in the Description', () => {
        expect(validate({ upsetAmount: UPSET_ROW, description: 'UPSET PRICE: $45,000.00' }).details.upsetAmount).toBe(
          224000,
        );
      });

      it('reads the free text, with a warning, when it states no figure', () => {
        expect(validate({ upsetAmount: 'SEE DESCRIPTION', description: 'UPSET PRICE: $45,000.00' })).toMatchObject({
          details: { upsetAmount: 45000 },
          warnings: [{ field: 'upsetAmount', value: 'SEE DESCRIPTION', reason: expect.stringContaining('figure') }],
        });
      });

      it('stays null, with a warning, when neither it nor the free text states a figure', () => {
        expect(validateFixture('listingDetailsHudsonUpsetNotNeeded.html')).toMatchObject({
          details: { sheriffId: '20061009', upsetAmount: null, judgment: 585314.42 },
          warnings: [
            { field: 'upsetAmount', value: 'COMMERCIAL PROPERTY - UPSET NOT NEEDED', reason: 'not a dollar amount' },
          ],
        });
      });
    });

    it('reads the free text when the upset row is blank', () => {
      expect(validate({ upsetAmount: ' \r ', description: 'UPSET PRICE: $45,000.00' }).details.upsetAmount).toBe(45000);
    });

    it('leaves the upset amount null, and the judgment as it was, when the only figure follows a judgment phrase', () => {
      expect(
        validate({
          judgment: '$250,000.00',
          description: 'The approximate amount of the judgment to be satisfied by the sale is $250,000.00.',
        }),
      ).toMatchObject({ details: { upsetAmount: null, judgment: 250000 }, warnings: [] });
    });

    it('leaves the upset amount null without a warning when the free text is blank', () => {
      expect(validate({ propertyDetails: '', propertyNote: '', description: '' })).toMatchObject({
        details: { upsetAmount: null },
        warnings: [],
      });
    });
  });

  describe('sale date', () => {
    it.each([
      ['8/5/2025', '2025-08-05'],
      ['10/20/2026', '2026-10-20'],
      ['08/12/2024 02:00 PM', '2024-08-12'],
      ['\r 7/5/2023   ', '2023-07-05'],
      ['2/29/2024', '2024-02-29'],
    ])('coerces %j to %j', (value, expected) => {
      expect(validate({ saleDate: value })).toMatchObject({ details: { saleDate: expected }, warnings: [] });
    });

    it('stores an empty sale date as null without a warning', () => {
      expect(validate({ saleDate: '' })).toMatchObject({ details: { saleDate: null }, warnings: [] });
    });

    it.each([
      '4/30/3021',
      '2/30/2024',
      '13/1/2024',
      '12/31/1999',
      `1/1/${DateTime.now().year + 6}`,
      '2024-08-12',
      'TBD',
    ])('stores %j as null with a warning', (value) => {
      expect(validate({ saleDate: value })).toMatchObject({
        details: { saleDate: null },
        warnings: [{ field: 'saleDate', value }],
      });
    });

    it('accepts a year up to five years ahead', () => {
      const year = DateTime.now().year + 5;

      expect(validate({ saleDate: `12/31/${year}` }).details.saleDate).toBe(`${year}-12-31`);
    });
  });

  describe('text', () => {
    it.each([
      ['plaintiff', '\r U.S. BANK NATIONAL ASSOCIATION                    ', 'U.S. BANK NATIONAL ASSOCIATION'],
      ['attorney', '  ATTORNEY FIRM, LLC\r', 'ATTORNEY FIRM, LLC'],
      ['description', '\r LINE ONE\r\nLINE TWO  ', 'LINE ONE\nLINE TWO'],
      ['priors', '   ', null],
      ['sheriffId', 'F-23001318', 'F-23001318'],
    ])('cleans %s %j to %j', (field, value, expected) => {
      expect(validate({ [field]: value })).toMatchObject({ details: { [field]: expected }, warnings: [] });
    });
  });

  describe('attorney phone', () => {
    it.each([
      '973-575-0707',
      '(973) 575-0707',
      '973 575-0707',
      '(973)575-0707',
      '(973)-575-0707',
      '1(973) 575-0707',
      '1(973)575-0707',
      '973.575.0707',
      '973-575-0707 (NJ)',
      '\r (973) 575-0707                    ',
    ])('normalizes %j to (973) 575-0707', (value) => {
      expect(validate({ attorneyPhone: value })).toMatchObject({
        details: { attorneyPhone: '(973) 575-0707' },
        warnings: [],
      });
    });

    it.each([
      ['856-813-1700 X 2021', '(856) 813-1700 x2021'],
      ['856-813-1700 x2021', '(856) 813-1700 x2021'],
      ['(856) 813-1700 EXT. 2021', '(856) 813-1700 x2021'],
      ['856-813-1700 ext 2021', '(856) 813-1700 x2021'],
    ])('normalizes the extension in %j to %j', (value, expected) => {
      expect(validate({ attorneyPhone: value })).toMatchObject({ details: { attorneyPhone: expected }, warnings: [] });
    });

    it.each([
      ['973-575-0707 EXT 1234 / FAX 973-575-0708 NICHOLAS', '973-575-0707 EXT 1234 / FAX 973-575-0708 NICHOLAS'],
      ['  575-0707\r', '575-0707'],
    ])('keeps the trimmed text of %j with a warning', (value, expected) => {
      expect(validate({ attorneyPhone: value })).toMatchObject({
        details: { attorneyPhone: expected },
        warnings: [{ field: 'attorneyPhone', value: expected, reason: 'not a single US phone number' }],
      });
    });
  });

  describe('unknown keys', () => {
    it('drops a key that is not a listing field, with a warning naming it', () => {
      const { details, warnings } = validate({ township: 'Totowa' });

      expect(details).not.toHaveProperty('township');
      expect(warnings).toEqual([{ field: 'township', value: 'Totowa', reason: 'not a listing field' }]);
    });

    it.each(['propertyNote', 'propertyDetails'])(
      'drops %s, read only for an upset amount, without a warning',
      (key) => {
        const { details, warnings } = validate({ [key]: 'Some note' });

        expect(details).not.toHaveProperty(key);
        expect(warnings).toEqual([]);
      },
    );

    it('drops Middlesex and Cape May’s Attorney File row without a warning', () => {
      const raw = parseListingDetails(readFixture('listingDetailsMiddlesex.html'));

      expect(raw).toHaveProperty('attorneyFile');
      expect(validateListingDetails(raw).warnings.map(({ field }) => field)).not.toContain('attorneyFile');
    });
  });

  it('collects a warning per bad field and still returns the listing', () => {
    const { details, warnings } = validate({
      upsetAmount: 'TBD',
      saleDate: '4/30/3021',
      plaintiff: 'BANK',
      township: 'Totowa',
    });

    expect(details).toMatchObject({ address: ADDRESS, plaintiff: 'BANK', upsetAmount: null, saleDate: null });
    expect(warnings.map(({ field }) => field).sort()).toEqual(['saleDate', 'township', 'upsetAmount']);
  });
});

describe('validateStatusHistory', () => {
  it('validates a parsed status table without warnings', () => {
    const { rows, warnings } = validateStatusHistory(parseStatusHistory(readFixture('listingDetailsPassaic.html')));

    expect(warnings).toEqual([]);
    expect(rows[0]).toEqual({ status: 'Scheduled', date: '2023-09-19' });
    expect(rows).toHaveLength(5);
  });

  it('coerces the dates of valid rows and trims their status', () => {
    expect(
      validateStatusHistory([
        { status: 'Scheduled', date: '9/19/2023' },
        { status: '\r Adjourned - Defendant  ', date: '10/17/2023 02:00 PM' },
      ]),
    ).toEqual({
      rows: [
        { status: 'Scheduled', date: '2023-09-19' },
        { status: 'Adjourned - Defendant', date: '2023-10-17' },
      ],
      warnings: [],
    });
  });

  it('skips a row dated 3021 with a warning and keeps the other rows', () => {
    expect(
      validateStatusHistory([
        { status: 'Scheduled', date: '3/2/2021' },
        { status: 'Adjourned', date: '4/30/3021' },
        { status: 'Sold', date: '5/4/2021' },
      ]),
    ).toEqual({
      rows: [
        { status: 'Scheduled', date: '2021-03-02' },
        { status: 'Sold', date: '2021-05-04' },
      ],
      warnings: [{ field: 'statusHistory.date', value: '4/30/3021', reason: expect.stringContaining('M/D/YYYY') }],
    });
  });

  it.each([
    [{ status: '  ', date: '9/19/2023' }, 'statusHistory.status'],
    [{ status: 'Scheduled', date: '' }, 'statusHistory.date'],
    [{ status: 'Scheduled', date: '2/30/2024' }, 'statusHistory.date'],
  ])('skips %j with a warning on %s', (row, field) => {
    expect(validateStatusHistory([row])).toEqual({
      rows: [],
      warnings: [expect.objectContaining({ field })],
    });
  });
});
