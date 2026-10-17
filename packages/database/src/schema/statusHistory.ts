import { relations } from 'drizzle-orm';
import { date, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { listings } from './listing';
import { randomUUID } from 'crypto';

export const statusHistories = pgTable('StatusHistory', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  listingId: text('listingId'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
  date: date('date', { mode: 'string' }).notNull(),
  status: text('status').notNull(),
  firstSeenOn: date('firstSeenOn', { mode: 'string' }),
  lastSeenOn: date('lastSeenOn', { mode: 'string' }),
});

export const statusHistoryRelations = relations(statusHistories, ({ one }) => ({
  listing: one(listings, {
    fields: [statusHistories.listingId],
    references: [listings.id],
  }),
}));

export type StatusHistory = typeof statusHistories.$inferSelect;
export type StatusHistoryInsert = typeof statusHistories.$inferInsert;
