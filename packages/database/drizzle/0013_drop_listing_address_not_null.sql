-- A Prisma-era NOT NULL that the Drizzle schema doesn't declare, so drizzle-kit never drops it (0007 dropped the
-- others). The scraper stores a blank address as NULL with a field warning, and this constraint failed those writes.
ALTER TABLE "Listing" ALTER COLUMN "address" DROP NOT NULL;
