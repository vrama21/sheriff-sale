import { cleanAddress } from '../../src/services/newJerseySheriffSale/cleanAddress';
import { assertAllInNj, cleanWhitespace, ExportedListing, planRow, recoverBoundary, separateGluedUnits } from './plan';

const exportedRow = (overrides: Partial<ExportedListing>): ExportedListing => ({
  id: 'listing-1',
  county: 'Essex',
  state: 'NJ',
  address: '',
  city: null,
  street: null,
  zipcode: null,
  unit: null,
  secondaryUnit: null,
  saleDate: '7/5/2023',
  ...overrides,
});

describe('recoverBoundary', () => {
  it.each([
    ['303 RENNER AVENUENEWARK NJ 07112', '303 RENNER AVENUE', 'NEWARK', '07112', 'known town'],
    ['108 CRAWFORD STREETEAST ORANGE NJ 07018', '108 CRAWFORD STREET', 'EAST ORANGE', '07018', 'known town'],
    ['12 MAIN STREETUNIT 15BEAST ORANGE NJ 07018', '12 MAIN STREETUNIT 15B', 'EAST ORANGE', '07018', 'known town'],
    ['206 Sumner StreetLandisville NJ 08326', '206 Sumner Street', 'Landisville', '08326', 'case boundary'],
    [
      '37 KOHOMO AVENUESICKLERVILLE (GLOUCESTER TWP.) NJ 08081',
      '37 KOHOMO AVENUE',
      'SICKLERVILLE (GLOUCESTER TWP.)',
      '08081',
      'glued suffix',
    ],
    ['14 PHEASANT CT.SICKLERVILLE NJ 08081', '14 PHEASANT CT.', 'SICKLERVILLE', '08081', 'glued suffix'],
    ['17 DEVON CT,HADDON TWP NJ', '17 DEVON CT,', 'HADDON TWP', '', 'glued suffix'],
    ['4575 ROUTE 47DELMONT NJ 08314', '4575 ROUTE 47', 'DELMONT', '08314', 'glued suffix'],
  ])('splits %j into street part %j and city %j', (address, streetPart, city, zipcode, method) => {
    expect(recoverBoundary(address)).toEqual({ streetPart, city, zipcode, method });
  });

  it('reads the ZIP from a ZIP+4', () => {
    expect(recoverBoundary('1840 FRONTAGE RDAPT 509CHERRY HILL TOWNSHIP NJ 08034-2203')).toMatchObject({
      city: 'CHERRY HILL TOWNSHIP',
      zipcode: '08034',
    });
  });

  it('ignores scraper whitespace around the address', () => {
    expect(recoverBoundary('\r 20 BRANFORD STREETNEWARK NJ 07114    ')).toMatchObject({
      streetPart: '20 BRANFORD STREET',
      city: 'NEWARK',
    });
  });

  it.each([
    ['no method matches', '56 KENWOOD DRIVEUNIT 56WINSLOW TWP NJ 08081'],
    ['the address has no trailing NJ', 'Unit 6 Building 9 Turnersville'],
    ['nothing precedes the NJ', 'NJ 08081'],
  ])('is unresolved when %s', (_, address) => {
    expect(recoverBoundary(address)).toBeUndefined();
  });
});

describe('separateGluedUnits', () => {
  it.each([
    ['200 WINSTON DRIVEUNIT 3114', '200 WINSTON DRIVE\nUNIT 3114'],
    ['225 West Leeds AvenueUnit 74', '225 West Leeds Avenue\nUnit 74'],
    ['1840 FRONTAGE RDAPT 509', '1840 FRONTAGE RD\nAPT 509'],
    ['5 OAK CT.BUILDING #2', '5 OAK CT.\nBUILDING #2'],
  ])('puts the line break back in %j', (streetPart, expected) => {
    expect(separateGluedUnits(streetPart)).toBe(expected);
  });

  it.each(['14 UNITY STREET', '12 COMMUNITY DRIVE', '5 BAPTIST CHURCH ROAD', '12 MAIN ST UNIT 4'])(
    'leaves %j alone',
    (streetPart) => {
      expect(separateGluedUnits(streetPart)).toBe(streetPart);
    },
  );
});

describe('cleanWhitespace', () => {
  it.each([
    ['\r 7/5/2023     ', '7/5/2023'],
    ['10/19/2026 02:00 PM', '10/19/2026 02:00 PM'],
    ['\r          ', ''],
    ['', ''],
  ])('cleans %j to %j', (value, expected) => {
    expect(cleanWhitespace(value)).toBe(expected);
  });
});

describe('planRow', () => {
  it('repairs a glued address the way a new scrape would store it', () => {
    const plan = planRow(exportedRow({ address: '303 RENNER AVENUENEWARK NJ 07112', city: 'Nuenewark' }));

    expect(plan.outcome).toBe('known town');
    expect(plan.values).toMatchObject({
      address: '303 RENNER AVENUE NEWARK NJ 07112',
      street: '303 Renner Avenue',
      city: 'Newark',
      zipcode: '07112',
    });
    expect(plan.values).toMatchObject(cleanAddress('303 RENNER AVENUE\nNEWARK NJ 07112'));
  });

  it('separates a glued unit line before normalizing', () => {
    const plan = planRow(exportedRow({ address: '200 WINSTON DRIVEUNIT 3114CLIFFSIDE PARK NJ 07010' }));

    expect(plan.values).toMatchObject({ street: '200 Winston Drive', unit: 'Unit 3114', city: 'Cliffside Park' });
  });

  it('removes scraper whitespace from a repaired address', () => {
    const plan = planRow(exportedRow({ address: '\r 20 BRANFORD STREETNEWARK NJ 07114        ' }));

    expect(plan.values.address).toBe('20 BRANFORD STREET NEWARK NJ 07114');
  });

  it('sets an empty city to NULL on a blank address', () => {
    const plan = planRow(exportedRow({ address: '', city: '' }));

    expect(plan.outcome).toBe('blank');
    expect(plan.values.city).toBeNull();
    expect(plan.changes).toEqual(['city']);
  });

  it('keeps a NULL city on a blank address', () => {
    const plan = planRow(exportedRow({ address: '\r         ', city: null }));

    expect(plan.outcome).toBe('blank');
    expect(plan.values).toMatchObject({ address: '', city: null });
    expect(plan.changes).toEqual(['address']);
  });

  it("drops an unresolved row's garbage city and keeps its other derived fields", () => {
    const row = exportedRow({
      address: '56 KENWOOD DRIVEUNIT 56WINSLOW TWP NJ 08081',
      city: 'Oaklyn Nj 08107 Collingswood Bgh',
      street: '56 Kenwood Driveunit 56winslow Twp',
      zipcode: '08081',
      unit: '',
      secondaryUnit: '',
    });
    const plan = planRow(row);

    expect(plan.outcome).toBe('unresolved');
    expect(plan.values).toEqual({
      address: row.address,
      city: null,
      street: row.street,
      zipcode: row.zipcode,
      unit: row.unit,
      secondaryUnit: row.secondaryUnit,
      saleDate: row.saleDate,
    });
    expect(plan.changes).toEqual(['city']);
  });

  it('cleans the whitespace of an unresolved address', () => {
    const plan = planRow(exportedRow({ address: '\r 56 KENWOOD DRIVEUNIT 56WINSLOW TWP NJ 08081          ' }));

    expect(plan.outcome).toBe('unresolved');
    expect(plan.values.address).toBe('56 KENWOOD DRIVEUNIT 56WINSLOW TWP NJ 08081');
  });

  it.each([
    ['\r 7/5/2023        ', '7/5/2023'],
    ['10/19/2026 02:00 PM', '10/19/2026 02:00 PM'],
    ['\r            ', ''],
  ])('cleans the sale date %j to %j', (saleDate, expected) => {
    expect(planRow(exportedRow({ saleDate })).values.saleDate).toBe(expected);
  });

  it('plans nothing for a row that is already correct', () => {
    const repaired = planRow(exportedRow({ address: '303 RENNER AVENUENEWARK NJ 07112', city: 'Nuenewark' }));

    expect(planRow({ ...repaired.row, ...repaired.values }).changes).toEqual([]);
  });

  it('never plans a state', () => {
    const plan = planRow(exportedRow({ address: '303 RENNER AVENUENEWARK NJ 07112' }));

    expect(plan.values).not.toHaveProperty('state');
  });
});

describe('assertAllInNj', () => {
  it('accepts an export where every row is in NJ', () => {
    expect(() => assertAllInNj([exportedRow({}), exportedRow({ id: 'listing-2' })])).not.toThrow();
  });

  it('rejects an export with a row outside NJ', () => {
    expect(() => assertAllInNj([exportedRow({}), exportedRow({ id: 'listing-2', state: 'PA' })])).toThrow(/listing-2/);
  });
});
