import { contentHash } from './contentHash';

const listing = {
  address: '263 Three Bridge Road Monroeville NJ 08343',
  county: 'Gloucester',
  plaintiff: 'PLAINTIFF BANK',
  propertyId: 1319120858,
  sheriffId: 'F-24000056',
  upsetAmount: '$275,983.46',
};

describe('contentHash', () => {
  it('is a SHA-256 hex digest', () => {
    expect(contentHash(listing)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores propertyId, snapshotDate, contentHash, id and timestamps', () => {
    expect(
      contentHash({
        ...listing,
        propertyId: 2195502430,
        snapshotDate: '2025-06-10',
        contentHash: 'abc',
        id: 'listing-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toBe(contentHash(listing));
  });

  it('does not depend on key order', () => {
    const reversed = Object.fromEntries(Object.entries(listing).reverse());

    expect(contentHash(reversed)).toBe(contentHash(listing));
  });

  it('hashes an undefined field the same as a null one', () => {
    expect(contentHash({ ...listing, judgment: null })).toBe(contentHash({ ...listing, judgment: undefined }));
  });

  it.each(Object.keys(listing).filter((key) => key !== 'propertyId'))('changes when %s changes', (key) => {
    expect(contentHash({ ...listing, [key]: 'changed' })).not.toBe(contentHash(listing));
  });

  it('changes when a field is added', () => {
    expect(contentHash({ ...listing, judgment: '$1.00' })).not.toBe(contentHash(listing));
  });
});
