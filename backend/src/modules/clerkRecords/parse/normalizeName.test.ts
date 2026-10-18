import { describe, expect, it } from 'vite-plus/test';
import { namesMatch, normalizeName, primaryDefendant, searchTermFor, splitDefendants } from './normalizeName';

describe('normalizeName', () => {
  it.each([
    ['John A. Smith', 'JOHN A SMITH'],
    ['U.S. Bank National Association, as Trustee for XYZ Trust 2006-1', 'US BANK'],
    ['U S BANK NATIONAL ASSOCIATION', 'US BANK'],
    ['Lakeview Loan Servicing, LLC', 'LAKEVIEW LOAN SERVICING'],
    ['AMERICAN NEIGHBORHOOD MTG ACCEPTANCE CO', 'AMERICAN NEIGHBORHOOD MORTGAGE ACCEPTANCE'],
    ['American Neighborhood Mortgage Acceptance Company, LLC', 'AMERICAN NEIGHBORHOOD MORTGAGE ACCEPTANCE'],
    ['Wells Fargo Bank, N.A.', 'WELLS FARGO BANK'],
    ['MORTGAGE ELECTRONIC REGISTRATION SYSTEMS INC AS NOMINEE FOR GUARANTEED RATE INC', 'GUARANTEED RATE'],
    ['MORTGAGE ELEC REGISTRATION SYSTEMS INC', 'MERS'],
    ['MERS', 'MERS'],
    ['JOHN SMITH ET AL', 'JOHN SMITH'],
    ['JOHN SMITH ET UX', 'JOHN SMITH'],
    ['JOHN SMITH H/W', 'JOHN SMITH'],
    ['JANE SMITH, HIS WIFE', 'JANE SMITH'],
    ['JOHN SMITH AKA JOHNNY SMITH', 'JOHN SMITH'],
    ['JOHN SMITH, INDIVIDUALLY', 'JOHN SMITH'],
    [
      'U.S. BANK TRUST NATIONAL ASSOCIATION, NOT IN ITS INDIVIDUAL CAPACITY BUT SOLELY AS OWNER TRUSTEE FOR VRMTG',
      'US BANK TRUST',
    ],
  ])('%s → %s', (name, normalized) => {
    expect(normalizeName(name)).toBe(normalized);
  });
});

describe('namesMatch', () => {
  it('matches a person regardless of token order', () => {
    expect(namesMatch('John A. Smith', 'SMITH JOHN A')).toBe(true);
  });

  it('strips trustee boilerplate from an entity', () => {
    expect(namesMatch('U.S. Bank National Association, as Trustee for XYZ Trust 2006-1', 'U S BANK NATIONAL ASSOCIATION')).toBe(
      true,
    );
  });

  it('does not match different people with the same surname', () => {
    expect(namesMatch('John Smith', 'SMITH JANE')).toBe(false);
  });

  it('matches the defendants and plaintiffs from the spike fixtures', () => {
    expect(namesMatch('CORAZON CABIGAO', 'CABIGAO CORAZON')).toBe(true);
    expect(namesMatch('RRA CP OPPORTUNITY TRUST 2', 'RRA CP OPPORTUNITY TRUST 2 ')).toBe(true);
    expect(namesMatch('ANDREW HAMILTON', 'HAMILTON ANDREW')).toBe(true);
    expect(namesMatch('Nicholas Hubbard Jr.', 'HUBBARD NICHOLAS JR')).toBe(true);
    expect(namesMatch('NAJEE LUNDY', 'LUNDY NAJEE')).toBe(true);
    expect(
      namesMatch('AMERICAN NEIGHBORHOOD MORTGAGE ACCEPTANCE COMPANY, LLC', 'AMERICAN NEIGHBORHOOD MTG ACCEPTANCE CO'),
    ).toBe(true);
    expect(namesMatch('Lakeview Loan Servicing, LLC', 'LAKEVIEW LOAN SERVICING')).toBe(true);
  });

  it('ignores a middle initial or generation only one side gives, but not a conflicting one', () => {
    expect(namesMatch('Andrew Hamilton', 'HAMILTON ANDREW L')).toBe(true);
    expect(namesMatch('Nicholas Hubbard', 'HUBBARD NICHOLAS SR')).toBe(true);
    expect(namesMatch('Nicholas Hubbard Jr.', 'HUBBARD NICHOLAS SR')).toBe(false);
    expect(namesMatch('Andrew K. Hamilton', 'HAMILTON ANDREW L')).toBe(false);
  });

  it('keeps distinct entities apart', () => {
    expect(namesMatch('Lakeview Loan Servicing, LLC', 'GUARANTEED RATE INC')).toBe(false);
    expect(namesMatch('U.S. Bank National Association', 'US BANK TRUST NATIONAL ASSOCIATION')).toBe(false);
  });
});

describe('splitDefendants', () => {
  const names = (defendant: string) => splitDefendants(defendant).map(({ name }) => name);

  it('splits on semicolons and drops et al and spouse-of placeholders', () => {
    expect(names('DANIEL M. BERKEY; MARSHALL COOPER; TRACY COOPER; IRUKA CAPITAL GROUP LLC')).toEqual([
      'DANIEL M. BERKEY',
      'MARSHALL COOPER',
      'TRACY COOPER',
      'IRUKA CAPITAL GROUP LLC',
    ]);
    expect(names('NAJEE LUNDY AND SPOUSE OF NAJEE LUNDY')).toEqual(['NAJEE LUNDY']);
    expect(names('ANDREW HAMILTON; ET. ALS.')).toEqual(['ANDREW HAMILTON']);
    expect(names('NAIIMA HORSLEY-FAUNTLEROY, ET. AL')).toEqual(['NAIIMA HORSLEY-FAUNTLEROY']);
    expect(names('CORAZON CABIGAO, ET ALS.')).toEqual(['CORAZON CABIGAO']);
  });

  it('keeps a surname-first name whole', () => {
    expect(names('SMITH, JOHN')).toEqual(['SMITH, JOHN']);
  });

  it('splits a comma list of full names after removing role phrases', () => {
    expect(names('JOHN SMITH, JANE SMITH')).toEqual(['JOHN SMITH', 'JANE SMITH']);
    expect(
      names('DENITA CURRY, INDIVIDUALLY AND AS CO-EXECUTRIX OF THE ESTATE OF MARY S. CURRY, DECEASED; MARK CURRY'),
    ).toEqual(['DENITA CURRY', 'MARK CURRY']);
  });

  it('splits Monmouth colons and ampersands', () => {
    expect(names('Hanning Family Real Estate LLC; Joeph M. Hanning: Jaclyn Anne Hanning')).toEqual([
      'Hanning Family Real Estate LLC',
      'Joeph M. Hanning',
      'Jaclyn Anne Hanning',
    ]);
    expect(names('Barker Circle Partnership,LLC & Fort Monmouth Economic Revitalization Authority')).toEqual([
      'Barker Circle Partnership, LLC',
      'Fort Monmouth Economic Revitalization Authority',
    ]);
  });

  it('drops the State and the United States', () => {
    expect(names('JOHN SMITH; STATE OF NEW JERSEY; UNITED STATES OF AMERICA')).toEqual(['JOHN SMITH']);
  });

  it('returns nothing for an empty defendant', () => {
    expect(splitDefendants(null)).toEqual([]);
  });
});

describe('searchTermFor', () => {
  it('searches a person by surname and first given name', () => {
    expect(searchTermFor({ name: 'Nicholas Hubbard Jr.', isEntity: false })).toEqual({
      lastName: 'HUBBARD',
      firstName: 'NICHOLAS',
    });
    expect(searchTermFor({ name: 'SMITH, JOHN A', isEntity: false })).toEqual({ lastName: 'SMITH', firstName: 'JOHN' });
  });

  it('searches an entity by its whole normalized name', () => {
    expect(searchTermFor({ name: 'JGA DEVELOPMENT, LLC', isEntity: true })).toEqual({ lastName: 'JGA DEVELOPMENT' });
  });

  it('prefers the first person over an earlier entity', () => {
    expect(primaryDefendant(splitDefendants('IRUKA CAPITAL GROUP LLC; DANIEL M. BERKEY'))?.name).toBe('DANIEL M. BERKEY');
  });
});
