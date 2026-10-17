-- Normalizes stored listings with the scraper's rules (backend/src/services/newJerseySheriffSale/listingSchema.ts),
-- so the next migration can cast "upsetAmount" and "judgment" to numeric and "saleDate" and "StatusHistory"."date"
-- to date. Keep the regexes here in step with listingSchema.ts. inspect_listing_values.sql previews these changes.
--
-- Prisma-era NOT NULLs that the Drizzle schema doesn't declare, so drizzle-kit never drops them.
ALTER TABLE "Listing" ALTER COLUMN "saleDate" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "Listing" ALTER COLUMN "plaintiff" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "Listing" ALTER COLUMN "sheriffId" DROP NOT NULL;
--> statement-breakpoint
-- Strip "\r", trim, and store '' as NULL. "address" stays as 0006 left it: it is NOT NULL.
UPDATE "Listing" SET
  "attorney" = nullif(btrim(replace("attorney", E'\r', ''), E' \t\n'), ''),
  "attorneyPhone" = nullif(btrim(replace("attorneyPhone", E'\r', ''), E' \t\n'), ''),
  "courtCase" = nullif(btrim(replace("courtCase", E'\r', ''), E' \t\n'), ''),
  "deed" = nullif(btrim(replace("deed", E'\r', ''), E' \t\n'), ''),
  "deedAddress" = nullif(btrim(replace("deedAddress", E'\r', ''), E' \t\n'), ''),
  "defendant" = nullif(btrim(replace("defendant", E'\r', ''), E' \t\n'), ''),
  "description" = nullif(btrim(replace("description", E'\r', ''), E' \t\n'), ''),
  "judgment" = nullif(btrim(replace("judgment", E'\r', ''), E' \t\n'), ''),
  "parcel" = nullif(btrim(replace("parcel", E'\r', ''), E' \t\n'), ''),
  "plaintiff" = nullif(btrim(replace("plaintiff", E'\r', ''), E' \t\n'), ''),
  "priors" = nullif(btrim(replace("priors", E'\r', ''), E' \t\n'), ''),
  "saleDate" = nullif(btrim(replace("saleDate", E'\r', ''), E' \t\n'), ''),
  "sheriffId" = nullif(btrim(replace("sheriffId", E'\r', ''), E' \t\n'), ''),
  "upsetAmount" = nullif(btrim(replace("upsetAmount", E'\r', ''), E' \t\n'), '');
--> statement-breakpoint
-- "status" and "date" are NOT NULL in prod, so they're trimmed here and the rows left empty are deleted below.
UPDATE "StatusHistory" SET
  "status" = btrim(replace("status", E'\r', ''), E' \t\n'),
  "date" = btrim(replace("date", E'\r', ''), E' \t\n');
--> statement-breakpoint
-- (AAA) BBB-CCCC, plus " xNNNN" for an extension. Any other phone keeps its trimmed text.
UPDATE "Listing"
SET "attorneyPhone" = (
  SELECT format('(%s) %s-%s', "m"[1], "m"[2], "m"[3]) || coalesce(' x' || "m"[4], '')
  FROM regexp_match(
    "attorneyPhone",
    '^1?\s*\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})(?:\s*\(NJ\))?(?:\s*(?:EXT\.?|X)\s*(\d{1,6}))?$',
    'i'
  ) AS "r"("m")
)
WHERE "attorneyPhone" ~* '^1?\s*\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})(?:\s*\(NJ\))?(?:\s*(?:EXT\.?|X)\s*(\d{1,6}))?$';
--> statement-breakpoint
-- An amount that isn't a non-negative decimal with at most two fraction digits is NULL, as in the scraper.
UPDATE "Listing" SET "upsetAmount" = NULL
WHERE regexp_replace("upsetAmount", '[$,\s]', '', 'g') !~ '^\d+(\.\d{1,2})?$';
--> statement-breakpoint
UPDATE "Listing" SET "judgment" = NULL
WHERE regexp_replace("judgment", '[$,\s]', '', 'g') !~ '^\d+(\.\d{1,2})?$';
--> statement-breakpoint
-- A sale date that isn't M/D/YYYY[ time], isn't a real date, or has a year outside 2000 to five years ahead is NULL.
-- The CASE keeps make_date from seeing a month it would reject.
UPDATE "Listing" SET "saleDate" = NULL
WHERE "saleDate" IS NOT NULL
  AND NOT coalesce((
    SELECT CASE
      WHEN "m"[1]::int NOT BETWEEN 1 AND 12
        OR "m"[3]::int NOT BETWEEN 2000 AND extract(year FROM now())::int + 5 THEN false
      ELSE "m"[2]::int BETWEEN 1 AND extract(day FROM make_date("m"[3]::int, "m"[1]::int, 1) + interval '1 month - 1 day')::int
    END
    FROM regexp_match("saleDate", '^(\d{1,2})/(\d{1,2})/(\d{4})(\s.*)?$') AS "r"("m")
  ), false);
--> statement-breakpoint
-- The scraper skips a status-history row with an empty status or an invalid date (expected: the 2 dated 3021).
DELETE FROM "StatusHistory"
WHERE "status" = ''
  OR NOT coalesce((
    SELECT CASE
      WHEN "m"[1]::int NOT BETWEEN 1 AND 12
        OR "m"[3]::int NOT BETWEEN 2000 AND extract(year FROM now())::int + 5 THEN false
      ELSE "m"[2]::int BETWEEN 1 AND extract(day FROM make_date("m"[3]::int, "m"[1]::int, 1) + interval '1 month - 1 day')::int
    END
    FROM regexp_match("date", '^(\d{1,2})/(\d{1,2})/(\d{4})(\s.*)?$') AS "r"("m")
  ), false);
