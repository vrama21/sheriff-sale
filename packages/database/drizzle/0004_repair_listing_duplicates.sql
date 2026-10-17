-- Repairs the Passaic/Gloucester duplicates so the unique index on "propertyId" (next migration) can be created.
-- Passaic used Gloucester's county ID (19) until adapt-scraper-to-civilview, so every Passaic row is a Gloucester listing.
UPDATE "Listing" SET "county" = 'Gloucester' WHERE "county" = 'Passaic';
--> statement-breakpoint
-- Keep the oldest listing per "propertyId"; delete the status histories of the rest, then the rest.
DELETE FROM "StatusHistory"
WHERE "listingId" IN (
  SELECT "id"
  FROM (
    SELECT "id", row_number() OVER (PARTITION BY "propertyId" ORDER BY "createdAt" NULLS LAST, "id") AS "rank"
    FROM "Listing"
    WHERE "propertyId" IS NOT NULL
  ) AS "ranked"
  WHERE "rank" > 1
);
--> statement-breakpoint
DELETE FROM "Listing"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT "id", row_number() OVER (PARTITION BY "propertyId" ORDER BY "createdAt" NULLS LAST, "id") AS "rank"
    FROM "Listing"
    WHERE "propertyId" IS NOT NULL
  ) AS "ranked"
  WHERE "rank" > 1
);
