import { relations } from 'drizzle-orm';
import { integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { statusHistories } from './statusHistory';
import { randomUUID } from 'crypto';

export const listings = pgTable('Listing', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  address: varchar('address', { length: 256 }),
  attorney: varchar('attorney', { length: 256 }),
  attorneyPhone: varchar('attorneyPhone', { length: 256 }),
  city: varchar('city', { length: 256 }),
  county: varchar('county', { length: 256 }),
  courtCase: varchar('courtCase', { length: 256 }),
  createdAt: timestamp('createdAt').defaultNow(),
  deed: varchar('deed', { length: 256 }),
  deedAddress: varchar('deedAddress', { length: 256 }),
  defendant: varchar('defendant', { length: 256 }),
  description: varchar('description', { length: 256 }),
  judgment: varchar('judgment', { length: 256 }),
  latitude: varchar('latitude', { length: 256 }),
  longitude: varchar('longitude', { length: 256 }),
  mapsUrl: varchar('mapsUrl', { length: 256 }),
  parcel: varchar('parcel', { length: 256 }),
  plaintiff: varchar('plaintiff', { length: 256 }),
  propertyId: integer('propertyId'),
  priors: varchar('priors', { length: 256 }),
  saleDate: varchar('saleDate', { length: 256 }),
  secondaryUnit: varchar('secondaryUnit', { length: 256 }),
  sheriffId: integer('sheriffId'),
  state: varchar('state', { length: 256 }),
  street: varchar('street', { length: 256 }),
  unit: varchar('unit', { length: 256 }),
  updatedAt: timestamp('updatedAt').defaultNow(),
  upsetAmount: varchar('upsetAmount', { length: 256 }),
  zipcode: varchar('zipcode', { length: 256 }),
});

export const listingRelations = relations(listings, ({ many }) => ({
  statusHistory: many(statusHistories),
}));

export type Listing = typeof listings.$inferSelect;
export type ListingInsert = typeof listings.$inferInsert;
