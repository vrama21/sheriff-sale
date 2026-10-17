import { ADDRESS_SUFFIX } from '../../src/services/constants';
import { cleanAddress } from '../../src/services/newJerseySheriffSale/cleanAddress';
import { TOWNS } from './towns';

/** One row of the read-only export of prod's "Listing" address fields. */
export interface ExportedListing {
  id: string;
  county: string | null;
  state: string | null;
  address: string | null;
  city: string | null;
  street: string | null;
  zipcode: string | null;
  unit: string | null;
  secondaryUnit: string | null;
  saleDate: string | null;
}

export const PLANNED_FIELDS = ['address', 'city', 'street', 'zipcode', 'unit', 'secondaryUnit', 'saleDate'] as const;

export type PlannedField = (typeof PLANNED_FIELDS)[number];
export type PlannedValues = Record<PlannedField, string | null>;

export type RecoveryMethod = 'known town' | 'case boundary' | 'glued suffix';
export type Outcome = RecoveryMethod | 'blank' | 'unresolved';

export interface Boundary {
  /** Everything before the city, as stored (units still glued on). */
  streetPart: string;
  /** The city text as stored, not a canonical name. */
  city: string;
  zipcode: string;
  method: RecoveryMethod;
}

export interface RowPlan {
  row: ExportedListing;
  outcome: Outcome;
  values: PlannedValues;
  /** The fields whose planned value differs from the stored one; empty when the row is already correct. */
  changes: PlannedField[];
}

// The trailing "NJ", "NJ 08084" or "NJ 08084-1234", and whatever separates it from the city.
const stateLineRegex = /^(.*?)[\s,]*\bNJ(?:\s*(\d{5})(?:-\d{4})?)?$/i;
// The last lowercase letter, digit, "." or ")" directly followed by an uppercase letter; greedy, so the last one wins.
const caseBoundaryRegex = /^(.*[a-z\d.)])([A-Z].*)$/;
// A suffix that starts a word and is followed by a letter, directly or after one "." or ",": "AVENUESICKLERVILLE", "CT.SICKLERVILLE".
const gluedSuffixRegexes = ADDRESS_SUFFIX.map(
  (suffix) => new RegExp(String.raw`(?<![A-Z0-9])${suffix}[.,]?(?=[A-Z])`, 'g'),
);
// A unit keyword glued to the end of the street: "DRIVEUNIT 3114", "AvenueUnit 74". It must end there, so "COMMUNITY" stays whole.
const gluedUnitRegex = /(?<=[A-Za-z.])(?=(?:UNIT|APT|APARTMENT|SUITE|BLDG|BUILDING)[\s.#\d])/gi;

const townsLongestFirst = [...TOWNS].sort((a, b) => b.length - a.length);

/** Removes carriage returns, collapses whitespace runs to one space and trims; an empty value stays ''. */
export const cleanWhitespace = (value: string) => value.replace(/\r/g, '').replace(/\s+/g, ' ').trim();

const byKnownTown = (text: string): Pick<Boundary, 'streetPart' | 'city'> | undefined => {
  const upperText = text.toUpperCase();
  const town = townsLongestFirst.find((name) => name.length < text.length && upperText.endsWith(name));

  return town ? { streetPart: text.slice(0, -town.length), city: text.slice(-town.length) } : undefined;
};

const byCaseBoundary = (text: string): Pick<Boundary, 'streetPart' | 'city'> | undefined => {
  if (!/[a-z]/.test(text)) {
    return undefined;
  }

  const match = caseBoundaryRegex.exec(text);

  return match && !/\d/.test(match[2]) ? { streetPart: match[1], city: match[2] } : undefined;
};

const byGluedSuffix = (text: string): Pick<Boundary, 'streetPart' | 'city'> | undefined => {
  if (/[a-z]/.test(text)) {
    return undefined;
  }

  let best: { start: number; end: number } | undefined;

  for (const regex of gluedSuffixRegexes) {
    for (const match of text.matchAll(regex)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const isLater = !best || start > best.start || (start === best.start && end > best.end);

      if (isLater && !/\d/.test(text.slice(end))) {
        best = { start, end };
      }
    }
  }

  return best ? { streetPart: text.slice(0, best.end), city: text.slice(best.end) } : undefined;
};

/**
 * Finds where the street ends and the city begins in an address whose line break was dropped
 * (`303 RENNER AVENUENEWARK NJ 07112`). Only the text before the trailing "NJ [ZIP]" is searched.
 */
export const recoverBoundary = (address: string): Boundary | undefined => {
  const stateLineMatch = stateLineRegex.exec(cleanWhitespace(address));

  if (!stateLineMatch || !stateLineMatch[1]) {
    return undefined;
  }

  const text = stateLineMatch[1];
  const methods: [RecoveryMethod, typeof byKnownTown][] = [
    ['known town', byKnownTown],
    ['case boundary', byCaseBoundary],
    ['glued suffix', byGluedSuffix],
  ];

  for (const [method, find] of methods) {
    const found = find(text);

    if (found && found.streetPart.trim()) {
      return { ...found, zipcode: stateLineMatch[2] ?? '', method };
    }
  }

  return undefined;
};

/** Puts back the line break that `innerText` dropped before a glued unit line: `DRIVEUNIT 3114` → `DRIVE\nUNIT 3114`. */
export const separateGluedUnits = (streetPart: string) => streetPart.replace(gluedUnitRegex, '\n');

const plannedValues = (row: ExportedListing): { outcome: Outcome; values: Omit<PlannedValues, 'saleDate'> } => {
  const address = row.address === null ? null : cleanWhitespace(row.address);
  const unknownCity = {
    address,
    city: null,
    street: row.street,
    zipcode: row.zipcode,
    unit: row.unit,
    secondaryUnit: row.secondaryUnit,
  };

  if (!address) {
    return { outcome: 'blank', values: unknownCity };
  }

  const boundary = recoverBoundary(address);

  if (!boundary) {
    return { outcome: 'unresolved', values: unknownCity };
  }

  const cityLine = `${boundary.city} NJ${boundary.zipcode ? ` ${boundary.zipcode}` : ''}`;
  const cleaned = cleanAddress(`${separateGluedUnits(boundary.streetPart)}\n${cityLine}`);

  // cleanAddress finds a city on every recovered line; if it ever doesn't, "no city" must still be NULL, never ''.
  return cleaned.city ? { outcome: boundary.method, values: cleaned } : { outcome: 'unresolved', values: unknownCity };
};

/** The backfill never writes `state`; it relies on every exported row being in NJ, and throws otherwise. */
export const assertAllInNj = (rows: ExportedListing[]) => {
  const notNj = rows.filter((row) => row.state !== 'NJ');

  if (notNj.length) {
    throw new Error(`${notNj.length} exported rows have a state other than NJ, e.g. listing ${notNj[0].id}`);
  }
};

/**
 * Plans one exported row: the address fields a new scrape of the same page would store, and its cleaned sale date.
 * Rows whose city can't be read get `city = NULL` and keep their other derived fields.
 */
export const planRow = (row: ExportedListing): RowPlan => {
  const { outcome, values: addressValues } = plannedValues(row);
  const values: PlannedValues = {
    ...addressValues,
    saleDate: row.saleDate === null ? null : cleanWhitespace(row.saleDate),
  };

  return { row, outcome, values, changes: PLANNED_FIELDS.filter((field) => values[field] !== row[field]) };
};
