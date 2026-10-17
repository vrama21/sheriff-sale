-- Read-only checks to run against prod before merging replay-archived-listings.
-- Not a migration: it isn't in meta/_journal.json, so the migrator never applies it.
-- The normalization repeats 0010_repair_listing_identity's, so the counts are what that migration will do.

-- Duplicate ("county", normalized "sheriffId") groups, the rows in them, and the rows the repair deletes.
WITH "normalized" AS (
  SELECT "county", nullif(regexp_replace("sheriffId", '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', '', 'g'), '') AS "sheriffId"
  FROM "Listing"
),
"groups" AS (
  SELECT "county", "sheriffId", count(*) AS "rows"
  FROM "normalized"
  WHERE "sheriffId" IS NOT NULL
  GROUP BY "county", "sheriffId"
)
SELECT
  count(*) FILTER (WHERE "rows" > 1) AS "duplicateGroups",
  coalesce(sum("rows") FILTER (WHERE "rows" > 1), 0) AS "rowsInDuplicateGroups",
  coalesce(sum("rows" - 1) FILTER (WHERE "rows" > 1), 0) AS "listingsToDelete",
  count(*) AS "listingsAfterRepair"
FROM "groups";

-- Rows without a sheriff number (NULL once normalized), which the repair leaves alone.
SELECT count(*) AS "blankSheriffIdRows"
FROM "Listing"
WHERE nullif(regexp_replace("sheriffId", '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', '', 'g'), '') IS NULL;

-- Status rows that move to a surviving listing, and status rows collapsed once statuses and dates are normalized.
WITH "ranked" AS (
  SELECT
    "id",
    CASE
      WHEN "sheriffId" IS NULL THEN "id"
      ELSE first_value("id") OVER (PARTITION BY "county", "sheriffId" ORDER BY "createdAt" DESC NULLS LAST, "id" DESC)
    END AS "survivorId"
  FROM (
    SELECT "id", "county", "createdAt", nullif(regexp_replace("sheriffId", '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', '', 'g'), '') AS "sheriffId"
    FROM "Listing"
  ) AS "listing"
),
"normalized" AS (
  SELECT
    "ranked"."survivorId",
    "ranked"."id" <> "ranked"."survivorId" AS "moves",
    btrim(regexp_replace("sh"."status", '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'), ' ') AS "status",
    "sh"."date"
  FROM "StatusHistory" AS "sh"
  JOIN "ranked" ON "ranked"."id" = "sh"."listingId"
)
SELECT
  count(*) AS "statusRows",
  count(*) FILTER (WHERE "moves") AS "statusRowsToMove",
  count(*) - count(DISTINCT ("survivorId", "status", "date")) AS "statusRowsToCollapse",
  count(DISTINCT ("survivorId", "status", "date")) AS "statusRowsAfterRepair"
FROM "normalized";

-- Status dates: 0008 made them dates, so the repair only needs their range.
SELECT min("date")::text AS "earliestStatusDate", max("date")::text AS "latestStatusDate", count(*) AS "rows"
FROM "StatusHistory";
