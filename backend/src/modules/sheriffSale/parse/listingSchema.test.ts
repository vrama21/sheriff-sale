import { DateTime } from 'luxon';
import { parseAddress } from '../../../shared/address';
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
      ['missing', {}],
      ['whitespace-only', { address: '\r  \n   ' }],
    ])('throws when the address is %s', (_case, raw) => {
      expect(() => validateListingDetails(raw)).toThrow('Listing has no address');
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

    it.each(['TBD', '$1,585.955', '-$5.00', '$1.585,95'])('stores %j as null with a warning', (value) => {
      expect(validate({ upsetAmount: value })).toMatchObject({
        details: { upsetAmount: null },
        warnings: [{ field: 'upsetAmount', value, reason: 'not a dollar amount' }],
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

    it('drops Property Note, which is on every page, without a warning', () => {
      const { details, warnings } = validate({ propertyNote: 'Some note' });

      expect(details).not.toHaveProperty('propertyNote');
      expect(warnings).toEqual([]);
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
