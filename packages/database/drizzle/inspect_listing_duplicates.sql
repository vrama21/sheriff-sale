-- Read-only checks to run against prod before merging listing-schema-fixes.
-- Not a migration: it isn't in meta/_journal.json, so the migrator never applies it.

-- Rows labelled Passaic (all relabelled to Gloucester by 0004_repair_listing_duplicates).
SELECT count(*) AS "passaicRows"
FROM "Listing"
WHERE "county" = 'Passaic';

-- propertyIds stored more than once, and how many rows they hold.
SELECT count(*) AS "duplicateGroups", coalesce(sum("rows"), 0) AS "rowsInDuplicateGroups"
FROM (
  SELECT "propertyId", count(*) AS "rows"
  FROM "Listing"
  WHERE "propertyId" IS NOT NULL
  GROUP BY "propertyId"
  HAVING count(*) > 1
) AS "duplicates";

-- Listings and status histories the repair would delete (every row ranked below first per propertyId).
WITH "ranked" AS (
  SELECT "id", row_number() OVER (PARTITION BY "propertyId" ORDER BY "createdAt" NULLS LAST, "id") AS "rank"
  FROM "Listing"
  WHERE "propertyId" IS NOT NULL
)
SELECT
  (SELECT count(*) FROM "ranked" WHERE "rank" > 1) AS "listingsToDelete",
  (SELECT count(*) FROM "StatusHistory" WHERE "listingId" IN (SELECT "id" FROM "ranked" WHERE "rank" > 1)) AS "statusHistoriesToDelete";

-- Largest stored propertyId (int4 tops out at 2147483647).
SELECT max("propertyId") AS "maxPropertyId"
FROM "Listing";
