import { DateTime } from 'luxon';
import { NJCounty } from '../../../shared/nj';
import { docketYear } from '../parse/docketYear';
import { extractParcel, sameParcel } from '../parse/extractParcel';
import { anyNameMatches, Defendant, primaryDefendant, searchTermFor, splitDefendants } from '../parse/normalizeName';
import { normalizeTown } from '../scrape/platforms/press/counties';
import { HostBlockedError } from '../scrape/hostLimiter';
import { ClerkDocumentRecord, ClerkPlatformClient, SearchResult } from '../scrape/types';

// The matching chain of design D5: the lis pendens by party, the parcel sweep, the foreclosed mortgage, and after the
// sale the sheriff's deed. Each step's search result decides the next search.

export type MatchRole =
  | 'FORECLOSED_LIS_PENDENS'
  | 'FORECLOSED_MORTGAGE'
  | 'MORTGAGE_ASSIGNMENT'
  | 'PRIOR_DEED'
  | 'SHERIFF_DEED'
  | 'RELATED';
export type MatchedBy = 'lis_pendens_party' | 'parcel' | 'cross_reference' | 'mortgage_party';
export type Confidence = 'high' | 'medium' | 'low';

export type DocumentMatch = { instrumentNumber: string; role: MatchRole; matchedBy: MatchedBy; confidence: Confidence };

/** The listing fields a lookup reads. `saleDate` is `YYYY-MM-DD`. */
export type ListingForLookup = {
  id: string;
  county: NJCounty;
  defendant: string | null;
  plaintiff: string | null;
  courtCase: string | null;
  saleDate: string;
  city: string | null;
  parcel: string | null;
  description: string | null;
};

export type LookupOutcome = 'matched' | 'no_lis_pendens' | 'complete';

export type ListingMatchResult = {
  listingId: string;
  outcome: LookupOutcome;
  /** The matched documents, each once. */
  documents: ClerkDocumentRecord[];
  matches: DocumentMatch[];
  unmappedDocTypes: string[];
  truncatedSearches: number;
};

/** The run's deadline passed mid-lookup; the listing stays due and nothing is written. */
export class LookupDeadlineError extends Error {
  public constructor(listingId: string) {
    super(`Run deadline reached during the lookup of listing ${listingId}`);
    this.name = 'LookupDeadlineError';
  }
}

export type MatchListingOptions = {
  now?: DateTime;
  /** Called between searches; true stops the lookup with a LookupDeadlineError. */
  pastDeadline?: () => boolean;
};

const ROLE_PRIORITY: MatchRole[] = [
  'FORECLOSED_LIS_PENDENS',
  'FORECLOSED_MORTGAGE',
  'SHERIFF_DEED',
  'MORTGAGE_ASSIGNMENT',
  'PRIOR_DEED',
  'RELATED',
];

const partiesOn = (document: ClerkDocumentRecord, side: 'direct' | 'indirect') =>
  document.parties.filter((party) => party.side === side).map((party) => party.name);

const allParties = (document: ClerkDocumentRecord) => document.parties.map((party) => party.name);

const latestFirst = (a: ClerkDocumentRecord, b: ClerkDocumentRecord) => b.recordedDate.localeCompare(a.recordedDate);

/** The window a foreclosure's lis pendens is recorded in: 1 January of the docket year, or 3 years, to the sale. */
export const lisPendensWindow = (listing: ListingForLookup, now: DateTime): { from: string; to: string } => {
  const year = docketYear(listing.courtCase, now);
  const sale = DateTime.fromISO(listing.saleDate, { zone: 'utc' });

  return { from: year ? `${year}-01-01` : (sale.minus({ years: 3 }).toISODate() as string), to: listing.saleDate };
};

const documentsOf = (
  result: SearchResult,
  listing: ListingForLookup,
): Extract<SearchResult, { kind: 'documents' }> | null => {
  if (result.kind === 'blocked') {
    throw new HostBlockedError(`${listing.county} County clerk portal`);
  }

  return result.kind === 'documents' ? result : null;
};

/**
 * Looks one listing up on its county's clerk platform and returns what to store. Rejects on a request or parse
 * failure, with a HostBlockedError when the host is refusing requests, and with a LookupDeadlineError at the deadline.
 */
export const matchListing = async (
  client: ClerkPlatformClient,
  listing: ListingForLookup,
  { now = DateTime.utc(), pastDeadline = () => false }: MatchListingOptions = {},
): Promise<ListingMatchResult> => {
  const checkDeadline = () => {
    if (pastDeadline()) {
      throw new LookupDeadlineError(listing.id);
    }
  };

  const documents = new Map<string, ClerkDocumentRecord>();
  const matches = new Map<string, DocumentMatch>();
  const unmapped = new Set<string>();
  let truncatedSearches = 0;

  const remember = (result: Extract<SearchResult, { kind: 'documents' }>) => {
    result.unmappedDocTypes.forEach((description) => unmapped.add(description));
    truncatedSearches += result.truncated ? 1 : 0;
  };

  const addMatch = (document: ClerkDocumentRecord, match: Omit<DocumentMatch, 'instrumentNumber'>) => {
    const seen = documents.get(document.instrumentNumber);

    // The same document from two searches: keep one, with every party either search showed.
    if (seen) {
      for (const party of document.parties) {
        if (!seen.parties.some(({ side, name }) => side === party.side && name === party.name)) {
          seen.parties.push(party);
        }
      }
    } else {
      documents.set(document.instrumentNumber, { ...document, parties: [...document.parties] });
    }

    const existing = matches.get(document.instrumentNumber);

    if (!existing || ROLE_PRIORITY.indexOf(match.role) < ROLE_PRIORITY.indexOf(existing.role)) {
      matches.set(document.instrumentNumber, { instrumentNumber: document.instrumentNumber, ...match });
    }
  };

  const defendants: Defendant[] = splitDefendants(listing.defendant);
  const defendantNames = defendants.map(({ name }) => name);
  const primary = primaryDefendant(defendants);
  const result = (outcome: LookupOutcome): ListingMatchResult => ({
    listingId: listing.id,
    outcome,
    documents: [...documents.values()],
    matches: [...matches.values()],
    unmappedDocTypes: [...unmapped],
    truncatedSearches,
  });

  if (!primary) {
    console.warn(`Listing ${listing.id} in ${listing.county} County has no searchable defendant`);

    return result('no_lis_pendens');
  }

  const listingParcel = extractParcel(listing.parcel, listing.description);
  // Resolved on each use: the client loads the county's municipality dropdown with its first search.
  const townAgrees = (document: ClerkDocumentRecord) =>
    !!document.municipality &&
    client
      .townCandidates(listing.city)
      .some((town) => normalizeTown(town) === normalizeTown(document.municipality ?? ''));
  const plaintiffAgrees = (document: ClerkDocumentRecord) =>
    !!listing.plaintiff && anyNameMatches(partiesOn(document, 'indirect'), [listing.plaintiff]);
  const hasDefendant = (document: ClerkDocumentRecord) => anyNameMatches(allParties(document), defendantNames);

  // 1. The lis pendens, from one name search across every doc type.
  checkDeadline();
  const nameSearch = documentsOf(
    await client.searchByName({ ...searchTermFor(primary), archive: { listingId: listing.id, step: 'name' } }),
    listing,
  );
  const named = nameSearch?.documents ?? [];

  if (nameSearch) {
    remember(nameSearch);
  }

  const window = lisPendensWindow(listing, now);
  const lisPendensCandidates = named
    .filter((document) => document.docCategory === 'LIS_PENDENS')
    .filter((document) => document.recordedDate >= window.from && document.recordedDate <= window.to)
    .map((document) => {
      const defendant = anyNameMatches(partiesOn(document, 'direct'), defendantNames);
      const plaintiff = plaintiffAgrees(document);
      const town = townAgrees(document);
      const parcel = !!listingParcel && sameParcel(document, listingParcel);

      if (!defendant || !(plaintiff || (town && parcel))) {
        return null;
      }

      return { document, confidence: (plaintiff && town ? 'high' : 'medium') as Confidence };
    })
    .filter((candidate) => candidate !== null)
    .sort((a, b) =>
      a.confidence === b.confidence ? latestFirst(a.document, b.document) : a.confidence === 'high' ? -1 : 1,
    );

  for (const { document, confidence } of lisPendensCandidates) {
    addMatch(document, { role: 'FORECLOSED_LIS_PENDENS', matchedBy: 'lis_pendens_party', confidence });
  }

  const lisPendens = lisPendensCandidates[0]?.document;

  // 2. The parcel sweep, where the county's index carries block/lot.
  let parcelDocuments: ClerkDocumentRecord[] = [];
  const deedIntoDefendant = named
    .filter((document) => document.docCategory === 'DEED' && document.block && document.lot)
    .filter((document) => anyNameMatches(partiesOn(document, 'indirect'), defendantNames))
    .sort(latestFirst)[0];
  type ParcelSource = {
    from: 'lis_pendens' | 'deed' | 'listing';
    municipality: string | null;
    block: string | null;
    lot: string | null;
    qualifier: string | null;
  };
  const fromDocument = (from: ParcelSource['from'], document: ClerkDocumentRecord): ParcelSource => ({
    from,
    municipality: document.municipality,
    block: document.block,
    lot: document.lot,
    qualifier: document.qualifier,
  });
  const parcelSource: ParcelSource | null =
    lisPendens?.block && lisPendens.lot
      ? fromDocument('lis_pendens', lisPendens)
      : deedIntoDefendant
        ? fromDocument('deed', deedIntoDefendant)
        : listingParcel
          ? { from: 'listing', municipality: listing.city, ...listingParcel }
          : null;

  if (client.coverage.parcelIndex && parcelSource?.block && parcelSource.lot && parcelSource.municipality) {
    checkDeadline();
    const sweep = documentsOf(
      await client.searchByParcel({
        municipality: parcelSource.municipality,
        block: parcelSource.block,
        lot: parcelSource.lot,
        qualifier: parcelSource.qualifier ?? undefined,
        archive: { listingId: listing.id, step: 'parcel' },
      }),
      listing,
    );

    if (sweep) {
      remember(sweep);
      parcelDocuments = sweep.documents;

      // A parcel read only from the listing's text is confirmed by a defendant on one of its documents; otherwise it's
      // probably a neighbour's lot from a metes-and-bounds description.
      if (parcelSource.from === 'listing' && !parcelDocuments.some(hasDefendant)) {
        console.warn(
          `Listing ${listing.id}: no defendant on any document of block ${parcelSource.block} lot ${parcelSource.lot}; ` +
            'ignoring the parcel sweep',
        );
        parcelDocuments = [];
      }
    }
  }

  for (const document of parcelDocuments) {
    const confidence: Confidence = hasDefendant(document) ? 'high' : 'medium';
    let role: MatchRole = 'RELATED';

    if (document.docCategory === 'SHERIFF_DEED' && document.recordedDate > listing.saleDate) {
      role = 'SHERIFF_DEED';
    } else if (document.docCategory === 'DEED' && anyNameMatches(partiesOn(document, 'indirect'), defendantNames)) {
      role = 'PRIOR_DEED';
    } else if (document.docCategory === 'MORTGAGE_ASSIGNMENT') {
      role = 'MORTGAGE_ASSIGNMENT';
    }

    addMatch(document, { role, matchedBy: 'parcel', confidence });
  }

  // 3. The foreclosed mortgage. PRESS exposes no cross-reference, so it's the parcel's latest mortgage by a defendant
  // before the lis pendens, or else a mortgage from the name search whose mortgagee ties to the foreclosing party.
  if (lisPendens) {
    const byDefendantBefore = (document: ClerkDocumentRecord) =>
      document.docCategory === 'MORTGAGE' &&
      document.recordedDate < lisPendens.recordedDate &&
      anyNameMatches(partiesOn(document, 'direct'), defendantNames);

    const fromParcel = parcelDocuments.filter(byDefendantBefore).sort(latestFirst)[0];
    let foreclosed: ClerkDocumentRecord[] = [];

    if (fromParcel) {
      addMatch(fromParcel, { role: 'FORECLOSED_MORTGAGE', matchedBy: 'parcel', confidence: 'high' });
      foreclosed = [fromParcel];
    } else {
      // The foreclosing party, and every earlier holder: an assignment to a foreclosing party makes its assignor one,
      // so a mortgage to GMAC assigned to the plaintiff is plausible.
      const assignments = [...named, ...parcelDocuments].filter(
        (document) => document.docCategory === 'MORTGAGE_ASSIGNMENT',
      );
      const foreclosingParties = [
        ...(listing.plaintiff ? [listing.plaintiff] : []),
        ...partiesOn(lisPendens, 'indirect'),
      ];

      for (let added = true; added;) {
        added = false;

        for (const assignment of assignments) {
          if (anyNameMatches(partiesOn(assignment, 'indirect'), foreclosingParties)) {
            for (const assignor of partiesOn(assignment, 'direct')) {
              if (!foreclosingParties.includes(assignor) && !anyNameMatches([assignor], defendantNames)) {
                foreclosingParties.push(assignor);
                added = true;
              }
            }
          }
        }
      }
      const plausible = named
        .filter(byDefendantBefore)
        .filter((document) => anyNameMatches(partiesOn(document, 'indirect'), foreclosingParties));

      for (const document of plausible) {
        addMatch(document, {
          role: 'FORECLOSED_MORTGAGE',
          matchedBy: 'mortgage_party',
          confidence: plausible.length === 1 ? 'medium' : 'low',
        });
      }

      foreclosed = plausible;
    }

    const earliestForeclosed = foreclosed.map(({ recordedDate }) => recordedDate).sort()[0];

    if (earliestForeclosed) {
      named
        .filter((document) => document.docCategory === 'MORTGAGE_ASSIGNMENT')
        .filter((document) => document.recordedDate > earliestForeclosed)
        .filter((document) => anyNameMatches(partiesOn(document, 'direct'), defendantNames))
        .forEach((document) =>
          addMatch(document, { role: 'MORTGAGE_ASSIGNMENT', matchedBy: 'mortgage_party', confidence: 'medium' }),
        );
    }
  }

  // 4. A sheriff's deed recorded after the sale ends the lookups.
  if ([...matches.values()].some(({ role }) => role === 'SHERIFF_DEED')) {
    return result('complete');
  }

  return result(lisPendens ? 'matched' : 'no_lis_pendens');
};
