import { NJCounty } from '../../../shared/nj';

// Kept in step with ClerkDocCategory in packages/database/src/schema/clerkRecords.ts (checked at compile time in ingest/syncClerkDocuments.ts).
export const DOC_CATEGORIES = [
  'DEED',
  'SHERIFF_DEED',
  'MORTGAGE',
  'MORTGAGE_ASSIGNMENT',
  'MORTGAGE_DISCHARGE',
  'MORTGAGE_MODIFICATION',
  'LIS_PENDENS',
  'LIS_PENDENS_DISCHARGE',
  'FINAL_JUDGMENT',
  'NOTICE_OF_SETTLEMENT',
  'TAX_SALE_CERTIFICATE',
  'LIEN',
  'OTHER',
] as const;

export type DocCategory = (typeof DOC_CATEGORIES)[number];

export type ClerkPlatform = 'press';

export type PartySide = 'direct' | 'indirect';

export type ClerkParty = { side: PartySide; name: string };

/** A cross-reference from one recorded document to another, by instrument number or by book and page. */
export type ClerkDocumentLinkTarget = { instrumentNumber: string | null; book: string | null; page: string | null };

/** One recorded document, grouped from its result-grid rows and validated. Dates are `YYYY-MM-DD`. */
export type ClerkDocumentRecord = {
  county: NJCounty;
  platform: ClerkPlatform;
  /** The county's instrument number, or `BK:<book>/<page>` when the index has none. */
  instrumentNumber: string;
  docCategory: DocCategory;
  docTypeRaw: string;
  recordedDate: string;
  bookType: string | null;
  book: string | null;
  page: string | null;
  municipality: string | null;
  block: string | null;
  lot: string | null;
  qualifier: string | null;
  /** Lots after the first, for a document indexed against several lots of one block. */
  extraLots: string[];
  consideration: number | null;
  detail: Record<string, unknown> | null;
  parties: ClerkParty[];
  links: ClerkDocumentLinkTarget[];
};

/** Names the archived result pages of one search: `<listingId>-<step>-<n>.html`. */
export type ArchiveContext = { listingId: string; step: string };

export type DateRange = {
  /** `YYYY-MM-DD`, inclusive. */
  from?: string;
  /** `YYYY-MM-DD`, inclusive. */
  to?: string;
};

export type NameSearchInput = DateRange & {
  /** A person's surname, or an entity's full name. */
  lastName: string;
  firstName?: string;
  /** Omitted or empty searches every doc type in one request. */
  docCategories?: DocCategory[];
  archive?: ArchiveContext;
};

export type ParcelSearchInput = DateRange & {
  /** The listing's city, or a dropdown label; resolved through the county's alias map. */
  municipality: string;
  block: string;
  lot: string;
  qualifier?: string;
  docCategories?: DocCategory[];
  archive?: ArchiveContext;
};

export type InstrumentSearchInput = { instrumentNumber: string; archive?: ArchiveContext };

export type SearchResult =
  | {
      kind: 'documents';
      documents: ClerkDocumentRecord[];
      /** Doc type descriptions missing from the county's map, stored as OTHER. */
      unmappedDocTypes: string[];
      /** True when paging stopped at MAX_RESULT_PAGES with more pages left. */
      truncated: boolean;
    }
  | { kind: 'municipality_unresolved'; municipality: string }
  | { kind: 'blocked' };

/** What matching needs to know about a county's index. */
export type ClerkIndexCoverage = {
  /** False when the county's index carries no block/lot, so a parcel sweep can't work. */
  parcelIndex: boolean;
  /** The earliest recorded date the block/lot index covers, `YYYY-MM-DD`; null when it covers everything. */
  parcelIndexStart: string | null;
};

/** One county on one clerk platform. Implementations keep their platform's quirks to themselves. */
export interface ClerkPlatformClient {
  readonly county: NJCounty;
  readonly platform: ClerkPlatform;
  readonly coverage: ClerkIndexCoverage;
  /** The clerk's municipality labels a listing city may appear as, best first. */
  townCandidates(city: string | null): string[];
  searchByName(input: NameSearchInput): Promise<SearchResult>;
  searchByParcel(input: ParcelSearchInput): Promise<SearchResult>;
  searchByInstrument(input: InstrumentSearchInput): Promise<SearchResult>;
  /** Detail metadata beyond the grid, for platforms that expose it. PRESS doesn't (see design, spike findings). */
  getDetail?(document: ClerkDocumentRecord): Promise<ClerkDocumentRecord>;
}

/** A result page that is neither a results grid nor the portal's no-records answer. */
export class ClerkParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ClerkParseError';
  }
}
