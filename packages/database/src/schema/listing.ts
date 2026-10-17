import { relations } from 'drizzle-orm';
import { bigint, date, numeric, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { statusHistories } from './statusHistory';
import { randomUUID } from 'crypto';

export const listings = pgTable(
  'Listing',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    address: text('address'),
    attorney: text('attorney'),
    attorneyPhone: varchar('attorneyPhone', { length: 256 }),
    city: varchar('city', { length: 256 }),
    county: varchar('county', { length: 256 }),
    courtCase: text('courtCase'),
    createdAt: timestamp('createdAt').defaultNow(),
    deed: text('deed'),
    deedAddress: text('deedAddress'),
    defendant: text('defendant'),
    description: text('description'),
    judgment: numeric('judgment', { precision: 12, scale: 2, mode: 'number' }),
    latitude: varchar('latitude', { length: 256 }),
    longitude: varchar('longitude', { length: 256 }),
    mapsUrl: varchar('mapsUrl', { length: 256 }),
    parcel: text('parcel'),
    plaintiff: text('plaintiff'),
    propertyId: bigint('propertyId', { mode: 'number' }),
    priors: text('priors'),
    saleDate: date('saleDate', { mode: 'string' }),
    secondaryUnit: varchar('secondaryUnit', { length: 256 }),
    sheriffId: text('sheriffId'),
    state: varchar('state', { length: 256 }),
    street: varchar('street', { length: 256 }),
    unit: varchar('unit', { length: 256 }),
    updatedAt: timestamp('updatedAt').defaultNow(),
    upsetAmount: numeric('upsetAmount', { precision: 12, scale: 2, mode: 'number' }),
    zipcode: varchar('zipcode', { length: 256 }),
  },
  (table) => [uniqueIndex('Listing_propertyId_key').on(table.propertyId)],
);

export const listingRelations = relations(listings, ({ many }) => ({
  statusHistory: many(statusHistories),
}));

export type Listing = typeof listings.$inferSelect;
export type ListingInsert = typeof listings.$inferInsert;
