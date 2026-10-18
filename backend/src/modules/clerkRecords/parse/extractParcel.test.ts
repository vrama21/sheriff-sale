import { describe, expect, it } from 'vite-plus/test';
import { extractParcel, normalizeParcelValue, sameParcel } from './extractParcel';

describe('extractParcel', () => {
  it('reads a Passaic parcel', () => {
    expect(extractParcel('TAX LOT 39 BLOCK 20.13', null)).toEqual({
      block: '20.13',
      lot: '39',
      extraLots: [],
      qualifier: null,
    });
  });

  it('reads a Union parcel with additional lots', () => {
    expect(extractParcel('LOT 6, ADDITIONAL LOTS 12, 18-B BLOCK 21', null)).toEqual({
      block: '21',
      lot: '6',
      extraLots: ['12', '18-B'],
      qualifier: null,
    });
  });

  it('reads a Hudson condo unit from the description', () => {
    expect(
      extractParcel(null, 'LOT 43 IN BLOCK 504 C0201 AND LOT 43 IN BLOCK 504 C0202 DIMENSIONS (APPROX.): 25.04X100'),
    ).toEqual({ block: '504', lot: '43', extraLots: [], qualifier: 'C0201' });
  });

  it('returns null for disclaimer text', () => {
    expect(extractParcel('the surplus, if any. This does not constitute a title search', 'Occupancy: Unknown')).toBeNull();
    expect(extractParcel(null, null)).toBeNull();
  });

  it.each([
    ['Tax Lot(s) 1 in Block 7.06', { block: '7.06', lot: '1' }],
    ['Tax Lot No. 1 in Block No. 2187.01', { block: '2187.01', lot: '1' }],
    ['Tax Lot No. 22 fka 28.A Block 2107 fka C0309', { block: '2107', lot: '22' }],
    ['Tax lot(s) 3-4 in Block 3613', { block: '3613', lot: '3', extraLots: ['4'] }],
    ['Lot 6 fka 00006, Block 44 fka 00044', { block: '44', lot: '6' }],
    ['Lot and Block: Lot 7, Block 76 Tax Map of Borough of Union Beach', { block: '76', lot: '7' }],
    ['Lot and Block: Lot 7.22 C1000, Block 164.01 Tax Map of Township of Howell', { block: '164.01', lot: '7.22', qualifier: 'C1000' }],
    ['Tax Lot 21 & 22 Block 161 Tax Map of Township of Aberdeen', { block: '161', lot: '21', extraLots: ['22'] }],
    ['Lot 4, Block 446 on the official Tax Map of the Township of Middletown', { block: '446', lot: '4' }],
    ['BLOCK 5806 LOT 63', { block: '5806', lot: '63' }],
    ['Blk 12 Lt 3', { block: '12', lot: '3' }],
  ])('reads the parcel field %s', (parcel, expected) => {
    expect(extractParcel(parcel, null)).toMatchObject({ extraLots: [], qualifier: null, ...expected });
  });

  it.each([
    ['LOT: 22 BLOCK: 62 APPROXIMTE DIMENSIONS: 58 FEET WIDE', { block: '62', lot: '22' }],
    ['LOT: 18 (AKA LOT 18 AND 19) BLOCK: 3042 APPROXIMATE DIMENSIONS', { block: '3042', lot: '18' }],
    ['LOT(S) 21, BLOCK 30 DIMENSIONS OF LOT (APPROXIMATELY): 25 X 100', { block: '30', lot: '21' }],
    ['LOT 1, BLOCK 8 QUALIFIER NO. C010H DIMENSIONS: CONDO UNIT', { block: '8', lot: '1', qualifier: 'C010H' }],
    ['LOT(S) 7, QUAL C0102, BLOCK 3901 DIMENSIONS OF THE LOT', { block: '3901', lot: '7', qualifier: 'C0102' }],
    ['TAX LOT 15 FKA 17 BLOCK 18705 FKA 1940 DIMENSIONS OF LOT', { block: '18705', lot: '15' }],
    [
      'FOR INFORMATION ONLY: COUNTY: BURLINGTON, MUNICIPALITY: PALMYRA BOROUGH TAX BLOCK: 60, TAX LOT: 5.01 AND 5.02 ADDRESS',
      { block: '60', lot: '5.01', extraLots: ['5.02'] },
    ],
  ])('reads the description %s', (description, expected) => {
    expect(extractParcel(null, description)).toMatchObject({ extraLots: [], qualifier: null, ...expected });
  });

  it('skips a neighbouring lot named in a metes-and-bounds boundary', () => {
    expect(
      extractParcel(
        null,
        'THENCE. 4. ALONG THE SOUTHWESTERLY LINE OF LOT: 7 IN BLOCK: 1104, SOUTH 37 DEGREES 04 MINUTES 45 SECONDS EAST',
      ),
    ).toBeNull();
  });

  it('ignores a subdivision plan block that is not a tax map block', () => {
    expect(extractParcel(null, 'BEING KNOWN AS LOT 19, BLOCK C-2703 ON PLAN OF LOTS, SECTION 3')).toBeNull();
  });

  it('prefers the parcel field over the description', () => {
    expect(extractParcel('Tax Lot 2 in Block 49.10', 'LOT 5 BLOCK 6')).toMatchObject({ block: '49.10', lot: '2' });
  });
});

describe('sameParcel', () => {
  it('ignores leading zeros in integer parts and keeps decimal blocks as they are', () => {
    expect(normalizeParcelValue('00044')).toBe('44');
    expect(normalizeParcelValue('049.04')).toBe('49.04');
    expect(sameParcel({ block: '0044', lot: '006' }, { block: '44', lot: '6' })).toBe(true);
    expect(sameParcel({ block: '20.13', lot: '39' }, { block: '20.1', lot: '39' })).toBe(false);
  });

  it('matches an extra lot', () => {
    expect(sameParcel({ block: '47.02', lot: '11', extraLots: ['11.01'] }, { block: '47.02', lot: '11.01' })).toBe(true);
  });

  it('never matches an unknown parcel', () => {
    expect(sameParcel({ block: null, lot: null }, { block: null, lot: null })).toBe(false);
  });
});
