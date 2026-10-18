import { describe, expect, it } from 'vite-plus/test';
import { parseAddress } from './parseAddress';

describe('parseAddress', () => {
  it('splits a mixed-case address on its line break', () => {
    expect(parseAddress('8 Floyd Drive\nTotowa NJ 07512')).toEqual({
      address: '8 Floyd Drive Totowa NJ 07512',
      street: '8 Floyd Drive',
      city: 'Totowa',
      state: 'NJ',
      zipcode: '07512',
      unit: '',
      secondaryUnit: '',
    });
  });

  it.each([
    ['7 WEBSTER AVENUE STRATFORD NJ 08084', '7 Webster Avenue', 'Stratford', '08084'],
    ['121 KNIGHT AVENUE RUNNEMEDE NJ 08078', '121 Knight Avenue', 'Runnemede', '08078'],
    ['142 MANOR AVE OAKLYN NJ 08107-1133', '142 Manor Ave', 'Oaklyn', '08107'],
    ['40-42 MYRTLE STREET\nBRIDGETON NJ 08302', '40-42 Myrtle Street', 'Bridgeton', '08302'],
    ['1020 North New Road\nPleasantville NJ 08232', '1020 North New Road', 'Pleasantville', '08232'],
    ['17 Granada Drive\nParsippany - Troy Hills NJ 07054', '17 Granada Drive', 'Parsippany - Troy Hills', '07054'],
    ['17 Granada Drive Parsippany - Troy Hills NJ 07054', '17 Granada Drive', 'Parsippany - Troy Hills', '07054'],
    ["12 O'NEIL CT\nMOUNT LAUREL, NJ 08054", "12 O'neil Ct", 'Mount Laurel', '08054'],
    ['88 BERGEN TURNPIKE RIDGEFIELD PARK NJ 07660', '88 Bergen Turnpike', 'Ridgefield Park', '07660'],
    ['601 BERLIN AVENUE CLEMENTON NJ', '601 Berlin Avenue', 'Clementon', ''],
  ])('splits %j into street %j, city %j and zipcode %j', (address, street, city, zipcode) => {
    expect(parseAddress(address)).toMatchObject({ street, city, zipcode });
  });

  it('keeps a unit out of the street', () => {
    expect(parseAddress('12 MAIN ST UNIT 4B\nTRENTON NJ 08608')).toEqual({
      address: '12 MAIN ST UNIT 4B TRENTON NJ 08608',
      street: '12 Main St',
      city: 'Trenton',
      state: 'NJ',
      zipcode: '08608',
      unit: 'Unit 4b',
      secondaryUnit: '',
    });
  });

  it('finds a unit and building in the one-line form', () => {
    expect(parseAddress('4 KINGSTON RUN BLDG 46 UNIT H1 NORTH BRUNSWICK NJ 08901')).toMatchObject({
      street: '4 Kingston Run',
      city: 'North Brunswick',
      unit: 'Unit H1',
      secondaryUnit: 'Bldg 46',
    });
  });

  it('keeps the whole address when it cannot find the parts', () => {
    expect(parseAddress('16 Rue Chagall Hamilton Township NJ 08330')).toEqual({
      address: '16 Rue Chagall Hamilton Township NJ 08330',
      street: '',
      city: '',
      state: 'NJ',
      zipcode: '08330',
      unit: '',
      secondaryUnit: '',
    });
  });
});
