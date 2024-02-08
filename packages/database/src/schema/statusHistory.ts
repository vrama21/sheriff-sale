import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { listing } from './listing';

export const statusHistory = pgTable('StatusHistory', {
  id: serial('id').primaryKey(),
  listingId: integer('listingId'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  date: varchar('date', { length: 12 }),
  status: varchar('status', { length: 256 }),
});

export const statusHistoryRelations = relations(statusHistory, ({ one }) => ({
  listing: one(listing, {
    fields: [statusHistory.listingId],
    references: [listing.id],
  }),
}));

export type StatusHistory = typeof statusHistory.$inferSelect;
