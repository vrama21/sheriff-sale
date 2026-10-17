import { relations } from 'drizzle-orm';
import { date, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { listings } from './listing';
import { randomUUID } from 'crypto';

export const statusHistories = pgTable(
  'StatusHistory',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    listingId: text('listingId'),
    createdAt: timestamp('createdAt').defaultNow(),
    updatedAt: timestamp('updatedAt').defaultNow(),
    date: date('date', { mode: 'string' }).notNull(),
    status: text('status').notNull(),
    // The first and last snapshot dates that showed this row. A listing's current rows have its latest lastSeenOn.
    firstSeenOn: date('firstSeenOn', { mode: 'string' }).notNull(),
    lastSeenOn: date('lastSeenOn', { mode: 'string' }).notNull(),
  },
  (table) => [uniqueIndex('StatusHistory_listingId_status_date_key').on(table.listingId, table.status, table.date)],
);

export const statusHistoryRelations = relations(statusHistories, ({ one }) => ({
  listing: one(listings, {
    fields: [statusHistories.listingId],
    references: [listings.id],
  }),
}));

export type StatusHistory = typeof statusHistories.$inferSelect;
export type StatusHistoryInsert = typeof statusHistories.$inferInsert;
