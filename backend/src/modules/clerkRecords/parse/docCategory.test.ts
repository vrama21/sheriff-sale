import { describe, expect, it } from 'vite-plus/test';
import { readPressFixture } from '../__fixtures__/readFixture';
import {
  BURLINGTON_DOC_TYPES,
  ESSEX_DOC_TYPES,
  MONMOUTH_DOC_TYPES,
  PASSAIC_DOC_TYPES,
} from '../scrape/platforms/press/docTypeOptions';
import { buildDocTypeMap, classifyDocType, refineDeedCategory } from './docCategory';
import { parsePressResultGrid } from './platforms/press/parsePressResultGrid';

describe('classifyDocType', () => {
  it.each([
    ['LIS PENDENS FORECLOSURE', 'LIS_PENDENS'],
    ['FORECLOSURE LISPENDENS', 'LIS_PENDENS'],
    ['DISCHARGE OF LISPENS', 'LIS_PENDENS_DISCHARGE'],
    ['LIS PENDENS - DISCHARGE', 'LIS_PENDENS_DISCHARGE'],
    ['DEED', 'DEED'],
    ['DEEDS From 10/01/1996 to Present', 'DEED'],
    ['DEED-FINAL JUDGEMENT', 'FINAL_JUDGMENT'],
    ["SHERIFF'S DEED", 'SHERIFF_DEED'],
    ['MASTER DEED', 'OTHER'],
    ['MORTGAGE', 'MORTGAGE'],
    ['MORTGAGES from 01/01/1976 to 12/31/1996', 'MORTGAGE'],
    ['ASSIGNMENT OF MORTGAGE', 'MORTGAGE_ASSIGNMENT'],
    ['DISCHARGE/MORTGAGE', 'MORTGAGE_DISCHARGE'],
    ['CANCELLATION OF MORTGAGE', 'MORTGAGE_DISCHARGE'],
    ['MORTGAGE POSTPONE - SUBORDINATION', 'MORTGAGE_MODIFICATION'],
    ['ASSIGNMENT OF LEASES AND RENTS', 'OTHER'],
    ['NOTICE/SETTLEMENT/CONTRACT & MTG', 'NOTICE_OF_SETTLEMENT'],
    ['DISCHARGE NOTICE OF SETTLEMENT', 'OTHER'],
    ['TAX SALE CERTIFICATE', 'TAX_SALE_CERTIFICATE'],
    ['FEDERAL LIEN', 'LIEN'],
    ['RELEASE OF FEDERAL LIEN', 'OTHER'],
    ['UCC 1', 'OTHER'],
  ])('%s → %s', (description, category) => {
    expect(classifyDocType(description)).toBe(category);
  });
});

describe('buildDocTypeMap', () => {
  it('selects all four of Essex’s lis pendens types for LIS_PENDENS', () => {
    const essex = buildDocTypeMap(ESSEX_DOC_TYPES);

    expect(
      essex.optionValuesFor('LIS_PENDENS').map((value) => ESSEX_DOC_TYPES.find(([option]) => option === value)?.[1]),
    ).toEqual([
      'LIS PENDENS FORECLOSURE',
      'LIS PENDENS FORECLOSURE AND RECOVERY',
      'LIS PENDENS IN REM',
      'LIS PENDENS RECOVERY',
    ]);
  });

  it('reports a description missing from the dropdown as unmapped OTHER', () => {
    expect(buildDocTypeMap(ESSEX_DOC_TYPES).categoryOf('SOMETHING NEW')).toEqual({ category: 'OTHER', mapped: false });
    expect(buildDocTypeMap(ESSEX_DOC_TYPES).categoryOf('MORTGAGE')).toEqual({ category: 'MORTGAGE', mapped: true });
  });

  it.each([
    ['essex', ESSEX_DOC_TYPES, ['name-all-types', 'parcel']],
    ['passaic', PASSAIC_DOC_TYPES, ['name-all-types', 'name-lis-pendens']],
    ['monmouth', MONMOUTH_DOC_TYPES, ['name-all-types', 'parcel', 'parcel-page2']],
    ['burlington', BURLINGTON_DOC_TYPES, ['name-all-types', 'parcel', 'parcel-page2']],
  ] as const)('maps every doc type in %s’s result fixtures', (county, options, fixtures) => {
    const map = buildDocTypeMap(options);

    for (const fixture of fixtures) {
      const page = parsePressResultGrid(readPressFixture(county, fixture), fixture);

      for (const row of page.kind === 'results' ? page.rows : []) {
        expect(map.categoryOf(row.type).mapped, row.type).toBe(true);
      }
    }
  });

  it('matches each county’s live dropdown fixture', () => {
    for (const [county, options] of [
      ['essex', ESSEX_DOC_TYPES],
      ['passaic', PASSAIC_DOC_TYPES],
      ['monmouth', MONMOUTH_DOC_TYPES],
      ['burlington', BURLINGTON_DOC_TYPES],
    ] as const) {
      const entry = readPressFixture(county, 'entry');

      for (const [value] of options) {
        expect(entry, `${county} ${value}`).toContain(`value="${value}"`);
      }
    }
  });
});

describe('refineDeedCategory', () => {
  it('treats a deed from the sheriff as a sheriff’s deed', () => {
    expect(refineDeedCategory('DEED', ['ESSEX COUNTY SHERIFF', 'SMITH JOHN'])).toBe('SHERIFF_DEED');
    expect(refineDeedCategory('DEED', ['SMITH JOHN'])).toBe('DEED');
    expect(refineDeedCategory('MORTGAGE', ['SHERIFF OF ESSEX'])).toBe('MORTGAGE');
  });
});
