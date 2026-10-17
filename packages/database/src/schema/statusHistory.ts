import { relations } from 'drizzle-orm';
import { date, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { listings } from './listing';
import { randomUUID } from 'crypto';

export const statusHistories = pgTable('StatusHistory', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  listingId: text('listingId'),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
  date: date('date', { mode: 'string' }),
  status: varchar('status', { length: 256 }),
});

export const statusHistoryRelations = relations(statusHistories, ({ one }) => ({
  listing: one(listings, {
    fields: [statusHistories.listingId],
    references: [listings.id],
  }),
}));

export type StatusHistory = typeof statusHistories.$inferSelect;
export type StatusHistoryInsert = typeof statusHistories.$inferInsert;
