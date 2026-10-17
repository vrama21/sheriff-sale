-- Repairs listing identity so the unique indexes on ("county", "sheriffId") and ("listingId", "status", "date")
-- (next migration) can be created. The site gives a sale a new "propertyId" on every search, so the insert-only
-- scraper stored one row per scrape of the same sale; the sheriff number is what stays stable within a county.
-- The normalization below mirrors backend/src/services/listingSync/normalize.ts exactly: replayed snapshots
-- only dedupe against these rows if both produce the same values. Whitespace is JavaScript's \s set.
-- Status dates need nothing here: 0008 made them dates, as the scraper's toIsoDate does.
--
-- Sheriff numbers lose all whitespace ("\r F-24000056   " -> "F-24000056"); a blank one is NULL and never merged.
UPDATE "Listing"
SET "sheriffId" = nullif(regexp_replace("sheriffId", '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', '', 'g'), '')
WHERE "sheriffId" IS DISTINCT FROM nullif(regexp_replace("sheriffId", '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', '', 'g'), '');
--> statement-breakpoint
-- Status text has whitespace runs collapsed and its ends trimmed.
UPDATE "StatusHistory"
SET "status" = btrim(regexp_replace("status", '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'), ' ')
WHERE "status" <> btrim(regexp_replace("status", '[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'), ' ');
--> statement-breakpoint
-- Every stored row is the snapshot of the day it was inserted, so that day is its snapshot date and the day
-- each of its status rows was seen.
UPDATE "Listing" SET "snapshotDate" = "createdAt"::date;
--> statement-breakpoint
UPDATE "StatusHistory" AS "sh"
SET "firstSeenOn" = "l"."createdAt"::date, "lastSeenOn" = "l"."createdAt"::date
FROM "Listing" AS "l"
WHERE "l"."id" = "sh"."listingId";
--> statement-breakpoint
-- One row per ("county", "sheriffId"): the newest row survives, since insert-only writes make it the newest
-- snapshot. The other rows' status rows move to it, keeping their seen dates, and the other rows are deleted.
UPDATE "StatusHistory" AS "sh"
SET "listingId" = "ranked"."survivorId"
FROM (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "county", "sheriffId" ORDER BY "createdAt" DESC NULLS LAST, "id" DESC
    ) AS "survivorId"
  FROM "Listing"
  WHERE "sheriffId" IS NOT NULL
) AS "ranked"
WHERE "sh"."listingId" = "ranked"."id" AND "ranked"."id" <> "ranked"."survivorId";
--> statement-breakpoint
DELETE FROM "Listing"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      first_value("id") OVER (
        PARTITION BY "county", "sheriffId" ORDER BY "createdAt" DESC NULLS LAST, "id" DESC
      ) AS "survivorId"
    FROM "Listing"
    WHERE "sheriffId" IS NOT NULL
  ) AS "ranked"
  WHERE "id" <> "survivorId"
);
--> statement-breakpoint
-- One status row per ("listingId", "status", "date"): the lowest "id" keeps the earliest "firstSeenOn" and the
-- latest "lastSeenOn" of its group, and the rest are deleted.
UPDATE "StatusHistory" AS "sh"
SET "firstSeenOn" = "grouped"."firstSeenOn", "lastSeenOn" = "grouped"."lastSeenOn"
FROM (
  SELECT
    "listingId",
    "status",
    "date",
    min("id") AS "keeperId",
    min("firstSeenOn") AS "firstSeenOn",
    max("lastSeenOn") AS "lastSeenOn"
  FROM "StatusHistory"
  WHERE "listingId" IS NOT NULL
  GROUP BY "listingId", "status", "date"
  HAVING count(*) > 1
) AS "grouped"
WHERE "sh"."id" = "grouped"."keeperId";
--> statement-breakpoint
DELETE FROM "StatusHistory"
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT "id", min("id") OVER (PARTITION BY "listingId", "status", "date") AS "keeperId"
    FROM "StatusHistory"
    WHERE "listingId" IS NOT NULL
  ) AS "grouped"
  WHERE "id" <> "keeperId"
);
