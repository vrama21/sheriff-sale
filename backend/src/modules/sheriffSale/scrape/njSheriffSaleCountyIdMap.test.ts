import { NJ_COUNTIES } from '../../../shared/nj';
import { NJSheriffSaleCountyIdMap } from './njSheriffSaleCountyIdMap';

describe('NJSheriffSaleCountyIdMap', () => {
  it('has an ID for every county', () => {
    NJ_COUNTIES.forEach((county) => {
      expect(NJSheriffSaleCountyIdMap[county]).toMatch(/^\d+$/);
    });
  });

  it('gives every county a different ID', () => {
    const ids = Object.values(NJSheriffSaleCountyIdMap);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses 17 for Passaic', () => {
    expect(NJSheriffSaleCountyIdMap.Passaic).toBe('17');
  });
});
