-- Read-only checks to run against prod before merging validate-scraped-listings. Each query computes what
-- 0007_normalize_listing_values and 0008's USING casts would do, from the stored text, without changing anything.
-- Not a migration: it isn't in meta/_journal.json, so the migrator never applies it.

-- Rows per column that 0007 changes, and the values it nulls because they don't fit the scraper's rules.
-- Expected: upsetAmountInvalid, judgmentInvalid and amountsOverflow 0; saleDateInvalid 2 (the Hunterdon 3021 dates).
WITH "cleaned" AS (
  SELECT
    "l".*,
    nullif(btrim(replace("l"."attorney", E'\r', ''), E' \t\n'), '') AS "newAttorney",
    nullif(btrim(replace("l"."attorneyPhone", E'\r', ''), E' \t\n'), '') AS "trimmedAttorneyPhone",
    nullif(btrim(replace("l"."courtCase", E'\r', ''), E' \t\n'), '') AS "newCourtCase",
    nullif(btrim(replace("l"."deed", E'\r', ''), E' \t\n'), '') AS "newDeed",
    nullif(btrim(replace("l"."deedAddress", E'\r', ''), E' \t\n'), '') AS "newDeedAddress",
    nullif(btrim(replace("l"."defendant", E'\r', ''), E' \t\n'), '') AS "newDefendant",
    nullif(btrim(replace("l"."description", E'\r', ''), E' \t\n'), '') AS "newDescription",
    nullif(btrim(replace("l"."judgment", E'\r', ''), E' \t\n'), '') AS "trimmedJudgment",
    nullif(btrim(replace("l"."parcel", E'\r', ''), E' \t\n'), '') AS "newParcel",
    nullif(btrim(replace("l"."plaintiff", E'\r', ''), E' \t\n'), '') AS "newPlaintiff",
    nullif(btrim(replace("l"."priors", E'\r', ''), E' \t\n'), '') AS "newPriors",
    nullif(btrim(replace("l"."saleDate", E'\r', ''), E' \t\n'), '') AS "trimmedSaleDate",
    nullif(btrim(replace("l"."sheriffId", E'\r', ''), E' \t\n'), '') AS "newSheriffId",
    nullif(btrim(replace("l"."upsetAmount", E'\r', ''), E' \t\n'), '') AS "trimmedUpsetAmount"
  FROM "Listing" AS "l"
),
"checked" AS (
  SELECT
    "c".*,
    regexp_replace("c"."trimmedUpsetAmount", '[$,\s]', '', 'g') ~ '^\d+(\.\d{1,2})?$' AS "upsetAmountValid",
    regexp_replace("c"."trimmedJudgment", '[$,\s]', '', 'g') ~ '^\d+(\.\d{1,2})?$' AS "judgmentValid",
    coalesce((
      SELECT CASE
        WHEN "m"[1]::int NOT BETWEEN 1 AND 12
          OR "m"[3]::int NOT BETWEEN 2000 AND extract(year FROM now())::int + 5 THEN false
        ELSE "m"[2]::int BETWEEN 1 AND extract(day FROM make_date("m"[3]::int, "m"[1]::int, 1) + interval '1 month - 1 day')::int
      END
      FROM regexp_match("c"."trimmedSaleDate", '^(\d{1,2})/(\d{1,2})/(\d{4})(\s.*)?$') AS "r"("m")
    ), false) AS "saleDateValid",
    (
      SELECT format('(%s) %s-%s', "m"[1], "m"[2], "m"[3]) || coalesce(' x' || "m"[4], '')
      FROM regexp_match(
        "c"."trimmedAttorneyPhone",
        '^1?\s*\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})(?:\s*\(NJ\))?(?:\s*(?:EXT\.?|X)\s*(\d{1,6}))?$',
        'i'
      ) AS "r"("m")
    ) AS "formattedAttorneyPhone"
  FROM "cleaned" AS "c"
)
SELECT
  count(*) AS "listings",
  count(*) FILTER (WHERE "attorney" IS DISTINCT FROM "newAttorney") AS "attorneyChanged",
  count(*) FILTER (
    WHERE "attorneyPhone" IS DISTINCT FROM coalesce("formattedAttorneyPhone", "trimmedAttorneyPhone")
  ) AS "attorneyPhoneChanged",
  count(*) FILTER (WHERE "trimmedAttorneyPhone" IS NOT NULL AND "formattedAttorneyPhone" IS NULL) AS "attorneyPhoneUnparsed",
  count(*) FILTER (WHERE "courtCase" IS DISTINCT FROM "newCourtCase") AS "courtCaseChanged",
  count(*) FILTER (WHERE "deed" IS DISTINCT FROM "newDeed") AS "deedChanged",
  count(*) FILTER (WHERE "deedAddress" IS DISTINCT FROM "newDeedAddress") AS "deedAddressChanged",
  count(*) FILTER (WHERE "defendant" IS DISTINCT FROM "newDefendant") AS "defendantChanged",
  count(*) FILTER (WHERE "description" IS DISTINCT FROM "newDescription") AS "descriptionChanged",
  count(*) FILTER (WHERE "parcel" IS DISTINCT FROM "newParcel") AS "parcelChanged",
  count(*) FILTER (WHERE "plaintiff" IS DISTINCT FROM "newPlaintiff") AS "plaintiffChanged",
  count(*) FILTER (WHERE "plaintiff" IS NOT NULL AND "newPlaintiff" IS NULL) AS "plaintiffBecomesNull",
  count(*) FILTER (WHERE "priors" IS DISTINCT FROM "newPriors") AS "priorsChanged",
  count(*) FILTER (WHERE "sheriffId" IS DISTINCT FROM "newSheriffId") AS "sheriffIdChanged",
  count(*) FILTER (WHERE "sheriffId" IS NOT NULL AND "newSheriffId" IS NULL) AS "sheriffIdBecomesNull",
  count(*) FILTER (WHERE "upsetAmount" IS NOT NULL AND "trimmedUpsetAmount" IS NULL) AS "upsetAmountEmptyToNull",
  count(*) FILTER (WHERE "trimmedUpsetAmount" IS NOT NULL AND NOT "upsetAmountValid") AS "upsetAmountInvalid",
  count(*) FILTER (WHERE "trimmedUpsetAmount" = '$0.00') AS "upsetAmountZero",
  count(*) FILTER (WHERE "judgment" IS NOT NULL AND "trimmedJudgment" IS NULL) AS "judgmentEmptyToNull",
  count(*) FILTER (WHERE "trimmedJudgment" IS NOT NULL AND NOT "judgmentValid") AS "judgmentInvalid",
  count(*) FILTER (WHERE "trimmedJudgment" = '$0.00') AS "judgmentZero",
  -- numeric(12,2) holds up to 9,999,999,999.99.
  count(*) FILTER (
    WHERE ("upsetAmountValid" AND regexp_replace("trimmedUpsetAmount", '[$,\s]', '', 'g')::numeric >= 1e10)
      OR ("judgmentValid" AND regexp_replace("trimmedJudgment", '[$,\s]', '', 'g')::numeric >= 1e10)
  ) AS "amountsOverflow",
  count(*) FILTER (WHERE "saleDate" IS NOT NULL AND "trimmedSaleDate" IS NULL) AS "saleDateEmptyToNull",
  count(*) FILTER (WHERE "trimmedSaleDate" IS NOT NULL AND NOT "saleDateValid") AS "saleDateInvalid"
FROM "checked";

-- Sale dates 0007 nulls as invalid, with their listing. Expected: the 2 Hunterdon listings dated 4/30/3021.
SELECT "l"."propertyId", "l"."county", "l"."saleDate"
FROM "Listing" AS "l"
WHERE nullif(btrim(replace("l"."saleDate", E'\r', ''), E' \t\n'), '') IS NOT NULL
  AND NOT coalesce((
    SELECT CASE
      WHEN "m"[1]::int NOT BETWEEN 1 AND 12
        OR "m"[3]::int NOT BETWEEN 2000 AND extract(year FROM now())::int + 5 THEN false
      ELSE "m"[2]::int BETWEEN 1 AND extract(day FROM make_date("m"[3]::int, "m"[1]::int, 1) + interval '1 month - 1 day')::int
    END
    FROM regexp_match(
      btrim(replace("l"."saleDate", E'\r', ''), E' \t\n'),
      '^(\d{1,2})/(\d{1,2})/(\d{4})(\s.*)?$'
    ) AS "r"("m")
  ), false)
ORDER BY "l"."propertyId";

-- Status histories 0007 deletes (empty status or invalid date), with their listing's propertyId. Expected: 2 rows.
SELECT "l"."propertyId", "s"."id", "s"."status", "s"."date"
FROM "StatusHistory" AS "s"
LEFT JOIN "Listing" AS "l" ON "l"."id" = "s"."listingId"
WHERE btrim(replace("s"."status", E'\r', ''), E' \t\n') = ''
  OR NOT coalesce((
    SELECT CASE
      WHEN "m"[1]::int NOT BETWEEN 1 AND 12
        OR "m"[3]::int NOT BETWEEN 2000 AND extract(year FROM now())::int + 5 THEN false
      ELSE "m"[2]::int BETWEEN 1 AND extract(day FROM make_date("m"[3]::int, "m"[1]::int, 1) + interval '1 month - 1 day')::int
    END
    FROM regexp_match(btrim(replace("s"."date", E'\r', ''), E' \t\n'), '^(\d{1,2})/(\d{1,2})/(\d{4})(\s.*)?$') AS "r"("m")
  ), false)
ORDER BY "l"."propertyId", "s"."date";

-- 20 attorney phones before and after 0007, one per distinct stored shape where possible.
SELECT DISTINCT ON (regexp_replace("before", '\d', '9', 'g')) "before", "after"
FROM (
  SELECT
    "attorneyPhone" AS "before",
    coalesce((
      SELECT format('(%s) %s-%s', "m"[1], "m"[2], "m"[3]) || coalesce(' x' || "m"[4], '')
      FROM regexp_match(
        nullif(btrim(replace("attorneyPhone", E'\r', ''), E' \t\n'), ''),
        '^1?\s*\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})(?:\s*\(NJ\))?(?:\s*(?:EXT\.?|X)\s*(\d{1,6}))?$',
        'i'
      ) AS "r"("m")
    ), nullif(btrim(replace("attorneyPhone", E'\r', ''), E' \t\n'), '')) AS "after"
  FROM "Listing"
  WHERE "attorneyPhone" IS NOT NULL
) AS "phones"
ORDER BY regexp_replace("before", '\d', '9', 'g')
LIMIT 20;
