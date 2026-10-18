import {
  ClerkDocCategory,
  clerkDocumentLinks,
  clerkDocumentParties,
  clerkDocuments,
  db,
  drizzleSql as sql,
} from '@sheriff-sale/database';
import { normalizeName } from '../parse/normalizeName';
import { ClerkDocumentRecord, DocCategory } from '../scrape/types';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The module's categories and the database enum must be the same list.
type SameCategories = [DocCategory] extends [ClerkDocCategory]
  ? [ClerkDocCategory] extends [DocCategory]
    ? true
    : never
  : never;
const sameCategories: SameCategories = true;
void sameCategories;

// Columns a later sighting may fill when they're null, and never blank (clerk-records-storage "Non-destructive
// document upsert").
const FILLABLE = [
  'bookType',
  'book',
  'page',
  'municipality',
  'block',
  'lot',
  'qualifier',
  'consideration',
  'detail',
] as const;

const fillNulls = Object.fromEntries(
  FILLABLE.map((column) => [column, sql.raw(`COALESCE("ClerkDocument"."${column}", excluded."${column}")`)]),
);

/**
 * Upserts documents on (county, instrumentNumber) and inserts their missing parties and links, inside `tx`. An existing
 * document gets a new lastSeenAt and fills its null columns; nothing it has is overwritten. Returns each document's id
 * by instrument number.
 */
export const syncClerkDocuments = async (
  tx: Tx,
  documents: ClerkDocumentRecord[],
  seenAt: Date,
): Promise<Map<string, string>> => {
  const ids = new Map<string, string>();

  if (documents.length === 0) {
    return ids;
  }

  const rows = await tx
    .insert(clerkDocuments)
    .values(
      documents.map((document) => ({
        county: document.county,
        instrumentNumber: document.instrumentNumber,
        platform: document.platform,
        docCategory: document.docCategory,
        docTypeRaw: document.docTypeRaw,
        recordedDate: document.recordedDate,
        bookType: document.bookType,
        book: document.book,
        page: document.page,
        municipality: document.municipality,
        block: document.block,
        lot: document.lot,
        qualifier: document.qualifier,
        consideration: document.consideration,
        detail: document.detail,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      })),
    )
    .onConflictDoUpdate({
      target: [clerkDocuments.county, clerkDocuments.instrumentNumber],
      set: { ...fillNulls, lastSeenAt: sql`excluded."lastSeenAt"`, updatedAt: sql`now()` },
    })
    .returning({ id: clerkDocuments.id, instrumentNumber: clerkDocuments.instrumentNumber });

  rows.forEach(({ id, instrumentNumber }) => ids.set(instrumentNumber, id));

  const parties = documents.flatMap((document) =>
    document.parties.map((party) => ({
      documentId: ids.get(document.instrumentNumber) as string,
      side: party.side,
      name: party.name,
      normalizedName: normalizeName(party.name),
    })),
  );

  if (parties.length > 0) {
    await tx.insert(clerkDocumentParties).values(parties).onConflictDoNothing();
  }

  const links = documents.flatMap((document) =>
    document.links.map((link) => ({
      fromDocumentId: ids.get(document.instrumentNumber) as string,
      toInstrumentNumber: link.instrumentNumber,
      toBook: link.book,
      toPage: link.page,
    })),
  );

  if (links.length > 0) {
    await tx.insert(clerkDocumentLinks).values(links).onConflictDoNothing();
  }

  // Links whose target is now stored, in the source document's county, point at it.
  await tx.execute(sql`
    UPDATE "ClerkDocumentLink" AS link
    SET "toDocumentId" = target.id
    FROM "ClerkDocument" AS source, "ClerkDocument" AS target
    WHERE link."toDocumentId" IS NULL
      AND source.id = link."fromDocumentId"
      AND target.county = source.county
      AND (
        target."instrumentNumber" = link."toInstrumentNumber"
        OR (link."toInstrumentNumber" IS NULL AND target.book = link."toBook" AND target.page = link."toPage")
      )
      AND source.county = ${documents[0].county}
  `);

  return ids;
};
