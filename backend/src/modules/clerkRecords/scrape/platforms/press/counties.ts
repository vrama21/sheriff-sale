import { NJCounty } from '../../../../../shared/nj';
import {
  BURLINGTON_DOC_TYPES,
  DocTypeOption,
  ESSEX_DOC_TYPES,
  MONMOUTH_DOC_TYPES,
  PASSAIC_DOC_TYPES,
} from './docTypeOptions';

// The four PRESS counties (press-scraping spec). Findings behind each value are in the change's design.md, "Spike
// findings".

export type PressCountyConfig = {
  county: NJCounty;
  entryUrl: string;
  /** Prefix of every form field the client fills: `ctl00$ContentPlaceHolder1$` or Passaic's `_ctl0:PageContent:`. */
  fieldPrefix: string;
  /** Passaic's older build only runs a search when the bare `hidDiv` field is `NewSearch`. */
  newSearchFlag: boolean;
  /** Burlington's Block/Lot tab has a qualifier field. */
  qualifierField: boolean;
  /** The longest From–To range the county accepts, in days; null when it has no limit. Dates are optional. */
  maxWindowDays: number | null;
  /** The largest `ddlShowRec` and `ddlTotalRec` options. */
  rowsPerPage: string;
  totalRecords: string;
  /** False when the index carries no block/lot (Passaic shows N/A on every document). */
  parcelIndex: boolean;
  /** The earliest recorded date the block/lot index covers, `YYYY-MM-DD`. */
  parcelIndexStart: string | null;
  /** Normalized listing city → the dropdown labels it may appear as, best first. See resolveMunicipality. */
  municipalityAliases: Record<string, string[]>;
  docTypes: readonly DocTypeOption[];
  /** A PEM intermediate for a host whose chain is incomplete. None is needed today (spike, task 1.4). */
  extraCa?: string;
};

export const PRESS_COUNTIES: Partial<Record<NJCounty, PressCountyConfig>> = {
  Essex: {
    county: 'Essex',
    entryUrl: 'https://press.essexregister.com/ProdPRESS/Clerk/ClerkHome.aspx?op=basic',
    fieldPrefix: 'ctl00$ContentPlaceHolder1$',
    newSearchFlag: false,
    qualifierField: false,
    maxWindowDays: 90,
    rowsPerPage: '100',
    totalRecords: '750',
    // The page says records are searchable from 10/01/1996; in practice only deeds carry block/lot.
    parcelIndex: true,
    parcelIndexStart: '1996-10-01',
    municipalityAliases: {
      'SOUTH ORANGE': ['SOUTH ORANGE VILLAGE'],
    },
    docTypes: ESSEX_DOC_TYPES,
  },
  Passaic: {
    county: 'Passaic',
    entryUrl: 'https://records.passaiccountynj.org/PRESS/clerk/ClerkHome.aspx?op=basic',
    fieldPrefix: '_ctl0:PageContent:',
    newSearchFlag: true,
    qualifierField: false,
    maxWindowDays: 90,
    rowsPerPage: '100',
    totalRecords: '750',
    parcelIndex: false,
    parcelIndexStart: null,
    municipalityAliases: {
      HEWITT: ['WEST MILFORD TOWNSHIP'],
      NEWFOUNDLAND: ['WEST MILFORD TOWNSHIP'],
      'OAK RIDGE': ['WEST MILFORD TOWNSHIP'],
      HASKELL: ['WANAQUE BOROUGH'],
      // West Paterson renamed itself Woodland Park in 2008; the index uses both.
      'WEST PATERSON': ['WOODLAND PARK', 'WEST PATERSON BOROUGH'],
      'WOODLAND PARK': ['WOODLAND PARK', 'WEST PATERSON BOROUGH'],
    },
    docTypes: PASSAIC_DOC_TYPES,
  },
  Monmouth: {
    county: 'Monmouth',
    entryUrl: 'https://oprs.co.monmouth.nj.us/oprs/clerk/clerkhome.aspx?op=basic',
    fieldPrefix: 'ctl00$ContentPlaceHolder1$',
    newSearchFlag: false,
    qualifierField: false,
    maxWindowDays: 90,
    rowsPerPage: '100',
    totalRecords: '2000',
    parcelIndex: true,
    parcelIndexStart: '1996-10-01',
    // The dropdown lists postal names next to municipalities, but documents carry the municipality: a Leonardo
    // lis pendens is indexed in MIDDLETOWN.
    municipalityAliases: {
      LEONARDO: ['MIDDLETOWN', 'LEONARDO'],
      BELFORD: ['MIDDLETOWN', 'BELFORD'],
      LINCROFT: ['MIDDLETOWN', 'LINCROFT'],
      NAVESINK: ['MIDDLETOWN', 'NAVESINK'],
      'PORT MONMOUTH': ['MIDDLETOWN', 'PORT MONMOUTH'],
      'NEW MONMOUTH': ['MIDDLETOWN', 'NEW MONMOUTH'],
      LOCUST: ['MIDDLETOWN', 'LOCUST'],
      MORGANVILLE: ['MARLBORO', 'MORGANVILLE'],
      WICKATUNK: ['MARLBORO', 'WICKATUNK'],
      OAKHURST: ['OCEAN TOWNSHIP', 'OAKHURST'],
      WANAMASSA: ['OCEAN TOWNSHIP', 'WANAMASSA'],
      NEPTUNE: ['NEPTUNE TOWNSHIP'],
      'OCEAN GROVE': ['NEPTUNE TOWNSHIP', 'OCEAN GROVE'],
      'SHARK RIVER HILLS': ['NEPTUNE TOWNSHIP', 'SHARK RIVER HILLS'],
      ALLENWOOD: ['WALL TOWNSHIP', 'ALLENWOOD'],
      'WEST BELMAR': ['WALL TOWNSHIP', 'WEST BELMAR'],
      CLIFFWOOD: ['ABERDEEN', 'CLIFFWOOD'],
      'CLIFFWOOD BEACH': ['ABERDEEN', 'CLIFFWOOD BEACH'],
      'CREAM RIDGE': ['UPPER FREEHOLD', 'CREAM RIDGE'],
      PERRINEVILLE: ['MILLSTONE', 'PERRINEVILLE'],
      ELBERON: ['LONG BRANCH', 'ELBERON'],
      'WEST END': ['LONG BRANCH', 'WEST END'],
      TENNENT: ['MANALAPAN', 'TENNENT'],
      FREEHOLD: ['FREEHOLD TWP', 'FREEHOLD BORO'],
    },
    docTypes: MONMOUTH_DOC_TYPES,
  },
  Burlington: {
    county: 'Burlington',
    entryUrl: 'https://press.burlingtoncountynj.gov/Press/clerk/ClerkHome.aspx?op=basic',
    fieldPrefix: 'ctl00$ContentPlaceHolder1$',
    newSearchFlag: false,
    qualifierField: true,
    maxWindowDays: 90,
    rowsPerPage: '100',
    totalRecords: '2000',
    parcelIndex: true,
    // "Property records recorded on or after March 1, 2012, can be searched by block and lot."
    parcelIndexStart: '2012-03-01',
    municipalityAliases: {
      'BROWNS MILLS': ['PEMBERTON TWP'],
      BIRMINGHAM: ['PEMBERTON TWP'],
      MARLTON: ['EVESHAM TWP'],
      COLUMBUS: ['MANSFIELD TWP'],
      VINCENTOWN: ['SOUTHAMPTON TWP'],
      ROEBLING: ['FLORENCE TWP'],
      JULIUSTOWN: ['SPRINGFIELD TWP'],
      JOBSTOWN: ['SPRINGFIELD TWP'],
      'INDIAN MILLS': ['SHAMONG TWP'],
      RANCOCAS: ['WESTAMPTON TWP'],
      COOKSTOWN: ['NEW HANOVER TWP'],
      CHATSWORTH: ['WOODLAND TWP'],
      MEDFORD: ['MEDFORD TWP'],
      PEMBERTON: ['PEMBERTON TWP', 'PEMBERTON BORO'],
      BORDENTOWN: ['BORDENTOWN TWP', 'BORDENTOWN CITY'],
      BURLINGTON: ['BURLINGTON TWP', 'BURLINGTON CITY'],
    },
    docTypes: BURLINGTON_DOC_TYPES,
  },
};

const SUFFIX_SYNONYMS: Array<[RegExp, string]> = [
  [/\bTOWNSHIP\b/g, 'TWP'],
  [/\bBOROUGH\b/g, 'BORO'],
  [/\bMT\b/g, 'MOUNT'],
  [/\bST\b/g, 'SAINT'],
  [/\bHEIGHTS\b/g, 'HGTS'],
];

/** Uppercase, no punctuation, `TOWNSHIP` → `TWP`, `BOROUGH` → `BORO`, `MT` → `MOUNT`. */
export const normalizeTown = (town: string): string => {
  let text = town
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const [pattern, replacement] of SUFFIX_SYNONYMS) {
    text = text.replace(pattern, replacement);
  }

  return text;
};

/** A town without its form of government: `PASSAIC CITY`, `CITY OF PASSAIC` → `PASSAIC`. */
const bareTown = (town: string): string =>
  normalizeTown(town)
    .replace(/^(?:CITY|TWP|BORO|TOWN|VILLAGE) OF /, '')
    .replace(/ (?:TWP|BORO|CITY|VILLAGE|TOWN)$/, '')
    .trim();

/**
 * The dropdown labels a listing city may appear as, best first (design D8): the county's alias map, then a label equal
 * to the city, then labels equal once `TWP`/`BORO`/`CITY`/`VILLAGE` are dropped, then the longest label the city text
 * ends with (`55 Tulip Lane Red Bank` → `RED BANK`). A parenthesised aside such as `Browns Mills (Pemberton Twp)` is
 * tried as a city too.
 */
export const resolveMunicipality = (config: PressCountyConfig, labels: string[], city: string | null): string[] => {
  if (!city) {
    return [];
  }

  const aside = /\(([^)]+)\)/.exec(city)?.[1];
  const cities = [city.replace(/\([^)]*\)/g, ' '), ...(aside ? [aside] : [])].map(normalizeTown).filter(Boolean);
  const candidates: string[] = [];
  const add = (label: string | undefined) => {
    if (label && !candidates.includes(label)) {
      candidates.push(label);
    }
  };

  for (const name of cities) {
    (config.municipalityAliases[name] ?? []).forEach(add);
    add(labels.find((label) => normalizeTown(label) === name));
    labels.filter((label) => bareTown(label) === bareTown(name)).forEach(add);
  }

  if (candidates.length === 0) {
    const [name] = cities;
    const endsWith = labels
      .filter((label) => name === normalizeTown(label) || name.endsWith(` ${normalizeTown(label)}`))
      .sort((a, b) => b.length - a.length);

    add(endsWith[0]);
  }

  return candidates;
};

/** The Block/Lot dropdown's non-town options: its prompt and `COUNTY WIDE`. */
export const isPlaceholderMunicipality = (label: string): boolean => /^PLEASE SELECT|^COUNTY WIDE$/i.test(label.trim());
