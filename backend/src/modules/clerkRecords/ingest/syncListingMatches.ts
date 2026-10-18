import { drizzleSql as sql, listingClerkDocuments } from '@sheriff-sale/database';
import { DocumentMatch } from '../match/matchListing';
import { Tx } from './syncClerkDocuments';

/**
 * Upserts the listing's matches on (listingId, documentId), inside `tx`: a re-match refreshes its role, method,
 * confidence and lastConfirmedAt. Matches the lookup didn't return stay as they are; nothing is deleted.
 */
export const syncListingMatches = async (
  tx: Tx,
  listingId: string,
  matches: DocumentMatch[],
  documentIds: Map<string, string>,
  confirmedAt: Date,
): Promise<number> => {
  const rows = matches.map((match) => {
    const documentId = documentIds.get(match.instrumentNumber);

    if (!documentId) {
      throw new Error(`Listing ${listingId} matched document ${match.instrumentNumber}, which wasn't stored`);
    }

    return {
      listingId,
      documentId,
      role: match.role,
      matchedBy: match.matchedBy,
      confidence: match.confidence,
      firstMatchedAt: confirmedAt,
      lastConfirmedAt: confirmedAt,
    };
  });

  if (rows.length === 0) {
    return 0;
  }

  await tx
    .insert(listingClerkDocuments)
    .values(rows)
    .onConflictDoUpdate({
      target: [listingClerkDocuments.listingId, listingClerkDocuments.documentId],
      set: {
        role: sql`excluded."role"`,
        matchedBy: sql`excluded."matchedBy"`,
        confidence: sql`excluded."confidence"`,
        lastConfirmedAt: sql`excluded."lastConfirmedAt"`,
      },
    });

  return rows.length;
};
