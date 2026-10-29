import { DateTime } from 'luxon';
import { z } from 'zod';
import { extractUpsetAmount } from './extractUpsetAmount';

/** A scraped value the schema couldn't coerce, or a detail-table key it doesn't know. */
export type FieldWarning = { field: string; value: string; reason: string };

export type RawStatusRow = { status: string; date: string };

type Warn = (warning: FieldWarning) => void;

// Keep these rules in step with drizzle/0007_normalize_listing_values.sql, which applies them to stored rows. The
// leading-amount rule (LEADING_MONEY_RE) is parser-only: rows stored before it keep their NULL until a re-scrape.
const MONEY_RE = /^\d+(\.\d{1,2})?$/;
// A dollar amount at the start of a longer value: `$384,211.73 GOOD THROUGH JULY 19, 2024`. It needs a `$` or comma
// grouping, so a value starting with a year or a count isn't money, and mustn't run on into more digits (`$1.585,95`).
const LEADING_MONEY_RE = /^(?:\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?(?![\d.,]?\d)/;
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(\s.*)?$/;
const PHONE_RE = /^1?\s*\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})(?:\s*\(NJ\))?(?:\s*(?:EXT\.?|X)\s*(\d{1,6}))?$/i;
const MIN_YEAR = 2000;
const MAX_YEARS_AHEAD = 5;

// The free text a page may state its upset price in, in the order it's read, when its upset row is blank or isn't an
// amount.
const UPSET_SOURCES = ['propertyDetails', 'propertyNote', 'description'];

// Detail-table labels that aren't listing fields but are expected, so dropping them isn't drift. The first two are
// read only as upset sources. Middlesex and Cape May publish an `Attorney File` row, blank on every archived page.
const IGNORED_KEYS = new Set(['propertyNote', 'propertyDetails', 'attorneyFile']);

/** Strips `\r` and trims; an empty or missing value is null. */
const cleanText = (value: string | undefined): string | null => value?.replace(/\r/g, '').trim() || null;

/** `M/D/YYYY`, optionally followed by a time, to `YYYY-MM-DD`; undefined when it isn't a real date in range. */
export const toIsoDate = (value: string): string | undefined => {
  const match = US_DATE_RE.exec(value);

  if (!match) {
    return undefined;
  }

  const [month, day, year] = match.slice(1, 4).map(Number);
  const date = DateTime.fromObject({ year, month, day });

  if (!date.isValid || year < MIN_YEAR || year > DateTime.now().year + MAX_YEARS_AHEAD) {
    return undefined;
  }

  return date.toISODate();
};

const toAmount = (value: string): number | undefined => {
  const amount = value.replace(/[$,\s]/g, '');

  return MONEY_RE.test(amount) ? Number(amount) : undefined;
};

const toPhone = (value: string): string | undefined => {
  const match = PHONE_RE.exec(value);

  if (!match) {
    return undefined;
  }

  const [, area, exchange, line, extension] = match;

  return `(${area}) ${exchange}-${line}${extension ? ` x${extension}` : ''}`;
};

const text = () => z.string().optional().transform(cleanText);

/**
 * Each line is trimmed with its spaces collapsed; the line breaks stay for parseAddress to split on. A missing or blank
 * address is null, with a warning: the listing is still identified by its county and sheriff number.
 */
const address = (warn: Warn) =>
  z
    .string()
    .optional()
    .transform((value): string | null => {
      const lines = (value ?? '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line)
        .join('\n');

      if (!lines) {
        warn({ field: 'address', value: value ?? '', reason: 'missing or blank' });

        return null;
      }

      return lines;
    });

/**
 * A cleaned text field run through `coerce`. Empty stays null without a warning: that's the site publishing nothing.
 * When `coerce` fails, the field warns and becomes `fallback(value)`.
 */
const coerced = <T>(
  warn: Warn,
  field: string,
  reason: string,
  coerce: (value: string) => T | undefined,
  fallback: (value: string) => T | null = () => null,
) =>
  text().transform((value): T | null => {
    if (value === null) {
      return null;
    }

    const coercedValue = coerce(value);

    if (coercedValue !== undefined) {
      return coercedValue;
    }

    warn({ field, value, reason });

    return fallback(value);
  });

/**
 * Like `coerced`, except that a value starting with a dollar amount keeps that amount, with a warning. Any other value
 * warns and becomes the figure `fromText` finds for it, if any.
 */
const money = (warn: Warn, field: string, fromText: (value: string) => string | undefined = () => undefined) =>
  text().transform((value): number | null => {
    if (value === null) {
      return null;
    }

    const amount = toAmount(value);

    if (amount !== undefined) {
      return amount;
    }

    const leadingAmount = LEADING_MONEY_RE.exec(value);

    if (leadingAmount) {
      warn({ field, value, reason: 'a dollar amount followed by other text, so only the amount was kept' });

      return toAmount(leadingAmount[0]) ?? null;
    }

    const figure = fromText(value);

    if (figure !== undefined) {
      warn({ field, value, reason: "not a dollar amount, so the upset figure stated in the page's text was kept" });

      return toAmount(figure) ?? null;
    }

    warn({ field, value, reason: 'not a dollar amount' });

    return null;
  });

const usDate = (warn: Warn, field: string) =>
  coerced(warn, field, `not a M/D/YYYY date from ${MIN_YEAR} to ${MAX_YEARS_AHEAD} years ahead`, toIsoDate);

// An unrecognised phone keeps its text: it's still useful to read, unlike a malformed amount or date.
const phone = (warn: Warn, field: string) =>
  coerced(warn, field, 'not a single US phone number', toPhone, (value) => value);

const listingDetailsSchema = (warn: Warn, upsetFromText?: (value: string) => string | undefined) =>
  z.object({
    address: address(warn),
    attorney: text(),
    attorneyPhone: phone(warn, 'attorneyPhone'),
    courtCase: text(),
    deed: text(),
    deedAddress: text(),
    defendant: text(),
    description: text(),
    judgment: money(warn, 'judgment'),
    parcel: text(),
    plaintiff: text(),
    priors: text(),
    saleDate: usDate(warn, 'saleDate'),
    sheriffId: text(),
    upsetAmount: money(warn, 'upsetAmount', upsetFromText),
  });

export type ScrapedListingDetails = z.output<ReturnType<typeof listingDetailsSchema>>;

const LISTING_FIELDS = new Set(Object.keys(listingDetailsSchema(() => undefined).shape));

/** The first upset figure in `texts`, read in order. */
const firstUpsetFigure = (texts: (string | undefined)[]): string | undefined => {
  for (const source of texts) {
    const figure = extractUpsetAmount(source ?? '');

    if (figure !== undefined) {
      return figure;
    }
  }

  return undefined;
};

/**
 * Validates and coerces a listing's detail-table values. A field that can't be coerced, the address included, is set
 * per its rule and reported in `warnings`. Unknown keys are dropped with a warning. A page whose upset row is missing
 * or blank takes its upset amount from its free text, when that states one. An upset row that isn't an amount
 * (`ESTIMATED UPSET BID AMOUNT: $224,000.00, PLUS …`) warns, and takes the figure its own text states, else the free
 * text's.
 */
export const validateListingDetails = (
  raw: Record<string, string>,
): { details: ScrapedListingDetails; warnings: FieldWarning[] } => {
  const warnings: FieldWarning[] = Object.entries(raw)
    .filter(([key]) => !LISTING_FIELDS.has(key) && !IGNORED_KEYS.has(key))
    .map(([key, value]) => ({ field: key, value, reason: 'not a listing field' }));

  const freeText = UPSET_SOURCES.map((key) => raw[key]);
  const result = listingDetailsSchema(
    (warning) => warnings.push(warning),
    (upsetRow) => firstUpsetFigure([upsetRow, ...freeText]),
  ).safeParse({
    ...raw,
    upsetAmount: cleanText(raw.upsetAmount) ?? firstUpsetFigure(freeText),
  });

  if (!result.success) {
    throw new Error(`Invalid listing details: ${z.prettifyError(result.error)}`);
  }

  return { details: result.data, warnings };
};

const statusRowSchema = z.object({
  status: text().pipe(z.string({ error: 'empty status' })),
  date: text()
    .transform((value) => (value === null ? undefined : toIsoDate(value)))
    .pipe(z.string({ error: `not a M/D/YYYY date from ${MIN_YEAR} to ${MAX_YEARS_AHEAD} years ahead` })),
});

export type StatusHistoryRow = z.output<typeof statusRowSchema>;

/** Keeps the rows with a status and a valid date; each other row is skipped with a warning. */
export const validateStatusHistory = (rows: RawStatusRow[]): { rows: StatusHistoryRow[]; warnings: FieldWarning[] } => {
  const validRows: StatusHistoryRow[] = [];
  const warnings: FieldWarning[] = [];

  rows.forEach((row) => {
    const result = statusRowSchema.safeParse(row);

    if (result.success) {
      validRows.push(result.data);

      return;
    }

    const [issue] = result.error.issues;
    const key: keyof RawStatusRow = issue.path[0] === 'status' ? 'status' : 'date';

    warnings.push({ field: `statusHistory.${key}`, value: row[key], reason: issue.message });
  });

  return { rows: validRows, warnings };
};
