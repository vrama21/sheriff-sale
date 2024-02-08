import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { listings } from './listing';

export const statusHistories = pgTable('StatusHistory', {
  id: serial('id').primaryKey(),
  listingId: integer('listingId'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  date: varchar('date', { length: 12 }),
  status: varchar('status', { length: 256 }),
});

export const statusHistoryRelations = relations(statusHistories, ({ one }) => ({
  listing: one(listings, {
    fields: [statusHistories.listingId],
    references: [listings.id],
  }),
}));

export type StatusHistory = typeof statusHistories.$inferSelect;
