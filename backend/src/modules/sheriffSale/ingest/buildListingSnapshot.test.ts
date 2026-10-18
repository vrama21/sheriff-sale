import { describe, expect, it } from 'vite-plus/test';
import { readFixture } from '../__fixtures__/stubClientAdapter';
import { ParsedListingPage, parseListingSnapshot } from '../parse/parseListingSnapshot';
import { buildListingSnapshot, SNAPSHOT_FIELDS } from './buildListingSnapshot';
import { contentHash } from './contentHash';

const page = (overrides: Partial<ParsedListingPage> = {}): ParsedListingPage => ({
  listing: {
    sheriffId: '\r F-24000056   ',
    saleDate: '07/15/2024 02:00 PM',
    upsetAmount: '$275,983.46',
    address: '263 Three Bridge Road\nMonroeville NJ 08343',
  },
  statusHistory: [
    { status: 'Scheduled', date: '07/20/2023' },
    { status: '\r Scheduled ', date: '7/20/2023' },
    { status: 'Adjourned - Court', date: '10/07/2024 02:00 PM' },
    { status: 'Adjourned - Court', date: '10/07/2024 03:00 PM' },
    { status: 'Cancelled', date: 'TBD' },
  ],
  ...overrides,
});

const build = (overrides: Partial<ParsedListingPage> = {}, propertyId = 1319120858) =>
  buildListingSnapshot({ page: page(overrides), county: 'Salem', propertyId, snapshotDate: '2024-07-02' });

describe('buildListingSnapshot', () => {
  it('validates the fields, cleans the address, normalizes the sheriff number and sets county, state and propertyId', () => {
    const { snapshot } = build();

    expect(snapshot.listing).toMatchObject({
      sheriffId: 'F-24000056',
      saleDate: '2024-07-15',
      upsetAmount: 275983.46,
      address: '263 Three Bridge Road Monroeville NJ 08343',
      street: '263 Three Bridge Road',
      city: 'Monroeville',
      zipcode: '08343',
      county: 'Salem',
      state: 'NJ',
      propertyId: 1319120858,
    });
    expect(snapshot.snapshotDate).toBe('2024-07-02');
  });

  it('sets every snapshot field, null when the page did not have it', () => {
    const { listing } = build().snapshot;

    SNAPSHOT_FIELDS.forEach((field) => expect(listing).toHaveProperty(field));
    expect(listing.judgment).toBeNull();
    expect(listing.plaintiff).toBeNull();
  });

  it('keeps valid status rows as ISO dates, drops rows that are the same once normalized, and warns on the rest', () => {
    const { snapshot, warnings } = build();

    expect(snapshot.statusHistory).toEqual([
      { status: 'Scheduled', date: '2023-07-20' },
      { status: 'Adjourned - Court', date: '2024-10-07' },
    ]);
    expect(warnings).toEqual([expect.objectContaining({ field: 'statusHistory.date', value: 'TBD' })]);
  });

  it('gives a null sheriff number when the page has none or a blank one', () => {
    expect(build({ listing: { address: '1 Main Street\nTrenton NJ 08608' } }).snapshot.listing.sheriffId).toBeNull();
    expect(
      build({ listing: { address: '1 Main Street\nTrenton NJ 08608', sheriffId: ' \r ' } }).snapshot.listing.sheriffId,
    ).toBeNull();
  });

  it('builds a page with no address with null address parts and an address warning', () => {
    const { snapshot, warnings } = build({ listing: { sheriffId: 'F-1' } });

    expect(snapshot.listing).toMatchObject({
      sheriffId: 'F-1',
      address: null,
      street: null,
      unit: null,
      secondaryUnit: null,
      city: null,
      zipcode: null,
      state: 'NJ',
    });
    expect(warnings).toContainEqual(expect.objectContaining({ field: 'address' }));
  });

  it('builds the archived Hunterdon page with a blank Address row, keeping its sheriff number and amounts', () => {
    const page = parseListingSnapshot(readFixture('listingDetailsHunterdonBlankAddress.html'));

    if (page.layout === 'unrecognised') {
      throw new Error('listingDetailsHunterdonBlankAddress.html layout not recognised');
    }

    const { snapshot, warnings } = buildListingSnapshot({
      page,
      county: 'Hunterdon',
      propertyId: 1736127112,
      snapshotDate: '2025-10-26',
    });

    expect(snapshot.listing).toMatchObject({
      sheriffId: 'F-4127',
      address: null,
      city: null,
      state: 'NJ',
      judgment: 1653036.41,
      upsetAmount: 1668737.41,
      saleDate: '2025-12-17',
    });
    expect(warnings).toEqual([{ field: 'address', value: '', reason: 'missing or blank' }]);
  });

  it('hashes the listing, the same for two snapshots that differ only in propertyId', () => {
    const { snapshot } = build();

    expect(snapshot.contentHash).toBe(contentHash(snapshot.listing));
    expect(build({}, 2195502430).snapshot.contentHash).toBe(snapshot.contentHash);
  });

  // Recorded before the module restructure. A change here means every stored listing would compare `updated` on its
  // next sync, so it has to be deliberate.
  it.each([
    ['listingDetailsPassaic.html', 'Passaic', 'd22506ef5247200fdac67845d20fba8748e1bb5de21b0efe7bcfa4e30431e303'],
    ['listingDetailsLegacySalem.html', 'Salem', 'e402432e6a9a23fe893dec05ce2bae8812b95f9e8fcfa91c151a263dc1da5188'],
  ] as const)('keeps the content hash of the %s fixture', (fixture, county, hash) => {
    const page = parseListingSnapshot(readFixture(fixture));

    if (page.layout === 'unrecognised') {
      throw new Error(`${fixture} layout not recognised`);
    }

    const { snapshot } = buildListingSnapshot({ page, county, propertyId: 1, snapshotDate: '2024-07-02' });

    expect(snapshot.contentHash).toBe(hash);
  });

  it('stores a Burlington notice that overflowed into Parcel # and Property Note as one description, with no parcel', () => {
    const page = parseListingSnapshot(readFixture('listingDetailsBurlingtonOverflow.html'));

    if (page.layout === 'unrecognised') {
      throw new Error('listingDetailsBurlingtonOverflow.html layout not recognised');
    }

    const { snapshot, warnings } = buildListingSnapshot({
      page,
      county: 'Burlington',
      propertyId: 2196778298,
      snapshotDate: '2026-10-18',
    });

    expect(snapshot.listing).toMatchObject({
      sheriffId: '26001077',
      street: '561 Inman Avenue',
      city: 'Cinnaminson',
      judgment: 157589.64,
      upsetAmount: 174055.95,
      parcel: null,
      description: expect.stringMatching(/^APPROXIMATE GOOD FAITH .* Attorney \(s\): 555 555-0100$/),
    });
    expect(warnings).toEqual([]);
  });
});
