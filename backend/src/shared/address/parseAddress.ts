import { ADDRESS_SUFFIX } from './addressSuffix';

// Longest first, so AVENUE is tried before AVE; word boundaries keep RUN from matching inside RUNNEMEDE.
const suffixPattern = [...ADDRESS_SUFFIX].sort((a, b) => b.length - a.length).join('|');
const unitPattern = String.raw`\b(?:UNIT|APT|SUITE|STE)\b[.\s#]*[0-9A-Z-]+|#\s*[0-9A-Z-]+`;
const secondaryUnitPattern = String.raw`\b(?:BUILDING|BLDG|ESTATE)\b[\s#]*[0-9A-Z]+`;
// Some listings leave the ZIP off.
const zipcodePattern = String.raw`(?:\s+(\d{5})(?:-\d{4})?)?`;

// "City NJ 08084" or "City, NJ 08084-1234", the second line of a details-page address.
const cityLineRegex = new RegExp(String.raw`^(.*?),?\s+NJ${zipcodePattern}$`, 'i');
// The one-line form: a street ending in a known suffix (then any unit or building), then the city line.
// ESTATE is left out here: in "Unit 1239 Timeshare Estate No. 49" it starts the next part, not the street.
const singleLineRegex = new RegExp(
  String.raw`^(.*\b(?:${suffixPattern})\b\.?(?:,?\s+(?:${unitPattern}|\b(?:BUILDING|BLDG)\b[\s#]*[0-9A-Z]+))*),?\s+(.+?),?\s+NJ${zipcodePattern}$`,
  'i',
);
const zipcodeRegex = /\bNJ\s+(\d{5})\b/i;
const unitRegex = new RegExp(unitPattern, 'i');
const secondaryUnitRegex = new RegExp(secondaryUnitPattern, 'i');

/** Lowercases, then capitalizes the first character of each space-separated word; keeps hyphens and apostrophes. */
const titleCase = (value: string) =>
  value
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const collapseSpaces = (value: string) => value.replace(/\s+/g, ' ').trim();

const splitAddress = (address: string): { street: string; city: string; zipcode: string } | undefined => {
  const lines = address.split('\n');
  const cityLineMatch = lines.length > 1 ? cityLineRegex.exec(collapseSpaces(lines[lines.length - 1])) : null;

  if (cityLineMatch) {
    return { street: lines.slice(0, -1).join(' '), city: cityLineMatch[1], zipcode: cityLineMatch[2] ?? '' };
  }

  const singleLineMatch = singleLineRegex.exec(collapseSpaces(address));

  if (singleLineMatch) {
    return { street: singleLineMatch[1], city: singleLineMatch[2], zipcode: singleLineMatch[3] ?? '' };
  }

  return undefined;
};

/** An address split into the parts every module stores, whatever shape its raw data came in. */
export type Address = {
  address: string | null;
  street: string | null;
  unit: string | null;
  secondaryUnit: string | null;
  city: string | null;
  state: string;
  zipcode: string | null;
};

/**
 * Splits a listing address, usually "<street>\n<City> NJ <zip>", into its parts.
 * `address` is always the whole value on one line, even when the parts can't be found. A null address, for a listing
 * that didn't publish one, gives null parts; `state` is still NJ.
 */
export const parseAddress = (address: string | null): Address => {
  if (address === null) {
    return { address: null, city: null, state: 'NJ', street: null, zipcode: null, unit: null, secondaryUnit: null };
  }

  const oneLineAddress = collapseSpaces(address);
  const parts = splitAddress(address);

  const streetLine = collapseSpaces(parts?.street ?? '');
  const unitMatch = unitRegex.exec(streetLine);
  const secondaryUnitMatch = secondaryUnitRegex.exec(streetLine);

  const street = streetLine
    .replace(unitMatch?.[0] ?? '', ' ')
    .replace(secondaryUnitMatch?.[0] ?? '', ' ')
    .replace(/[\s,]+$/, '');

  return {
    address: oneLineAddress,
    city: titleCase(collapseSpaces(parts?.city ?? '')),
    state: 'NJ',
    street: titleCase(collapseSpaces(street)),
    zipcode: parts?.zipcode || (zipcodeRegex.exec(oneLineAddress)?.[1] ?? ''),
    unit: unitMatch ? titleCase(collapseSpaces(unitMatch[0])) : '',
    secondaryUnit: secondaryUnitMatch ? titleCase(collapseSpaces(secondaryUnitMatch[0])) : '',
  };
};
