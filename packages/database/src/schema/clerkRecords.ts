import { relations } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { listings } from './listing';

// Documents recorded at a county clerk, and how they tie to listings. Recorded documents don't change, so writes are
// insert-mostly; see the clerk-records-storage spec.

export const clerkPlatformEnum = pgEnum('ClerkPlatform', ['press']);

export const clerkDocCategoryEnum = pgEnum('ClerkDocCategory', [
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
]);

export const clerkPartySideEnum = pgEnum('ClerkPartySide', ['direct', 'indirect']);

export const listingClerkRoleEnum = pgEnum('ListingClerkRole', [
  'FORECLOSED_LIS_PENDENS',
  'FORECLOSED_MORTGAGE',
  'MORTGAGE_ASSIGNMENT',
  'PRIOR_DEED',
  'SHERIFF_DEED',
  'RELATED',
]);

export const listingClerkMatchedByEnum = pgEnum('ListingClerkMatchedBy', [
  'lis_pendens_party',
  'parcel',
  'cross_reference',
  'mortgage_party',
]);

export const listingClerkConfidenceEnum = pgEnum('ListingClerkConfidence', ['high', 'medium', 'low']);

export const listingClerkOutcomeEnum = pgEnum('ListingClerkOutcome', [
  'matched',
  'no_lis_pendens',
  'unsupported',
  'error',
  'complete',
]);

export const clerkDocuments = pgTable(
  'ClerkDocument',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    county: varchar('county', { length: 256 }).notNull(),
    // The county's instrument number, or `BK:<book>/<page>` for a record indexed only by book and page.
    instrumentNumber: text('instrumentNumber').notNull(),
    platform: clerkPlatformEnum('platform').notNull(),
    docCategory: clerkDocCategoryEnum('docCategory').notNull(),
    docTypeRaw: text('docTypeRaw').notNull(),
    recordedDate: date('recordedDate', { mode: 'string' }).notNull(),
    bookType: text('bookType'),
    book: text('book'),
    page: text('page'),
    municipality: text('municipality'),
    block: text('block'),
    lot: text('lot'),
    qualifier: text('qualifier'),
    consideration: numeric('consideration', { precision: 14, scale: 2, mode: 'number' }),
    detail: jsonb('detail'),
    firstSeenAt: timestamp('firstSeenAt', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('lastSeenAt', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('createdAt').defaultNow(),
    updatedAt: timestamp('updatedAt').defaultNow(),
  },
  (table) => [
    uniqueIndex('ClerkDocument_county_instrumentNumber_key').on(table.county, table.instrumentNumber),
    index('ClerkDocument_county_block_lot_idx').on(table.county, table.block, table.lot),
  ],
);

export const clerkDocumentParties = pgTable(
  'ClerkDocumentParty',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('documentId')
      .notNull()
      .references(() => clerkDocuments.id, { onDelete: 'cascade' }),
    side: clerkPartySideEnum('side').notNull(),
    name: text('name').notNull(),
    normalizedName: text('normalizedName').notNull(),
  },
  (table) => [
    uniqueIndex('ClerkDocumentParty_documentId_side_name_key').on(table.documentId, table.side, table.name),
    index('ClerkDocumentParty_normalizedName_idx').on(table.normalizedName),
  ],
);

export const clerkDocumentLinks = pgTable(
  'ClerkDocumentLink',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromDocumentId: uuid('fromDocumentId')
      .notNull()
      .references(() => clerkDocuments.id, { onDelete: 'cascade' }),
    toInstrumentNumber: text('toInstrumentNumber'),
    toBook: text('toBook'),
    toPage: text('toPage'),
    // Filled once the target document is stored.
    toDocumentId: uuid('toDocumentId').references(() => clerkDocuments.id, { onDelete: 'set null' }),
  },
  // A link targets an instrument number or a book and page, so the unused columns are NULL; NULLS NOT DISTINCT keeps
  // the target unique anyway.
  (table) => [
    unique('ClerkDocumentLink_from_target_key')
      .on(table.fromDocumentId, table.toInstrumentNumber, table.toBook, table.toPage)
      .nullsNotDistinct(),
  ],
);

export const listingClerkDocuments = pgTable(
  'ListingClerkDocument',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: text('listingId')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    documentId: uuid('documentId')
      .notNull()
      .references(() => clerkDocuments.id, { onDelete: 'cascade' }),
    role: listingClerkRoleEnum('role').notNull(),
    matchedBy: listingClerkMatchedByEnum('matchedBy').notNull(),
    confidence: listingClerkConfidenceEnum('confidence').notNull(),
    firstMatchedAt: timestamp('firstMatchedAt', { withTimezone: true }).notNull().defaultNow(),
    lastConfirmedAt: timestamp('lastConfirmedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ListingClerkDocument_listingId_documentId_key').on(table.listingId, table.documentId),
    index('ListingClerkDocument_documentId_idx').on(table.documentId),
  ],
);

export const listingClerkLookups = pgTable(
  'ListingClerkLookup',
  {
    listingId: text('listingId')
      .primaryKey()
      .references(() => listings.id, { onDelete: 'cascade' }),
    platform: clerkPlatformEnum('platform'),
    lastCheckedAt: timestamp('lastCheckedAt', { withTimezone: true }).notNull(),
    // NULL when no further checks are due.
    nextCheckAt: timestamp('nextCheckAt', { withTimezone: true }),
    lastOutcome: listingClerkOutcomeEnum('lastOutcome').notNull(),
    consecutiveMisses: integer('consecutiveMisses').notNull().default(0),
    consecutiveErrors: integer('consecutiveErrors').notNull().default(0),
    lastError: text('lastError'),
  },
  (table) => [index('ListingClerkLookup_nextCheckAt_idx').on(table.nextCheckAt)],
);

export const clerkDocumentRelations = relations(clerkDocuments, ({ many }) => ({
  parties: many(clerkDocumentParties),
  links: many(clerkDocumentLinks, { relationName: 'linkSource' }),
  listingMatches: many(listingClerkDocuments),
}));

export const clerkDocumentPartyRelations = relations(clerkDocumentParties, ({ one }) => ({
  document: one(clerkDocuments, { fields: [clerkDocumentParties.documentId], references: [clerkDocuments.id] }),
}));

export const clerkDocumentLinkRelations = relations(clerkDocumentLinks, ({ one }) => ({
  from: one(clerkDocuments, {
    fields: [clerkDocumentLinks.fromDocumentId],
    references: [clerkDocuments.id],
    relationName: 'linkSource',
  }),
}));

export const listingClerkDocumentRelations = relations(listingClerkDocuments, ({ one }) => ({
  listing: one(listings, { fields: [listingClerkDocuments.listingId], references: [listings.id] }),
  document: one(clerkDocuments, { fields: [listingClerkDocuments.documentId], references: [clerkDocuments.id] }),
}));

export type ClerkDocument = typeof clerkDocuments.$inferSelect;
export type ClerkDocumentInsert = typeof clerkDocuments.$inferInsert;
export type ClerkDocumentParty = typeof clerkDocumentParties.$inferSelect;
export type ClerkDocumentLink = typeof clerkDocumentLinks.$inferSelect;
export type ListingClerkDocument = typeof listingClerkDocuments.$inferSelect;
export type ListingClerkLookup = typeof listingClerkLookups.$inferSelect;
export type ClerkDocCategory = (typeof clerkDocCategoryEnum.enumValues)[number];
export type ListingClerkRole = (typeof listingClerkRoleEnum.enumValues)[number];
export type ListingClerkMatchedBy = (typeof listingClerkMatchedByEnum.enumValues)[number];
export type ListingClerkConfidence = (typeof listingClerkConfidenceEnum.enumValues)[number];
export type ListingClerkOutcome = (typeof listingClerkOutcomeEnum.enumValues)[number];
