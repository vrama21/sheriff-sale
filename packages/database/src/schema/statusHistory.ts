import { integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

export const statusHistory = pgTable('statusHistory', {
  id: serial('id').primaryKey(),
  listingId: integer('listingId'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  date: varchar('date', { length: 12 }),
  status: varchar('status', { length: 256 }),
});

export type StatusHistory = typeof statusHistory.$inferSelect;
