import { createHash } from 'crypto';

// propertyId changes on every search, so hashing it would make every snapshot look changed.
const unhashedKeys = new Set(['propertyId', 'snapshotDate', 'contentHash', 'id', 'createdAt', 'updatedAt']);

/**
 * SHA-256 hex of the listing's fields as JSON in sorted key order, leaving out its identifiers and bookkeeping.
 * An undefined field hashes the same as a null one.
 */
export const contentHash = (listing: object): string => {
  const fields = Object.entries(listing)
    .filter(([key]) => !unhashedKeys.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]: [string, unknown]) => [key, value ?? null]);

  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(fields)))
    .digest('hex');
};
