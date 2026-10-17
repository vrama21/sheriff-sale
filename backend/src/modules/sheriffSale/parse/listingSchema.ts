import { DateTime } from 'luxon';
import { z } from 'zod';

/** A scraped value the schema couldn't coerce, or a detail-table key it doesn't know. */
export type FieldWarning = { field: string; value: string; reason: string };

export type RawStatusRow = { status: string; date: string };

type Warn = (warning: FieldWarning) => void;

// Keep these rules in step with drizzle/0007_normalize_listing_values.sql, which applies them to stored rows.
const MONEY_RE = /^\d+(\.\d{1,2})?$/;
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(\s.*)?$/;
const PHONE_RE = /^1?\s*\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})(?:\s*\(NJ\))?(?:\s*(?:EXT\.?|X)\s*(\d{1,6}))?$/i;
const MIN_YEAR = 2000;
const MAX_YEARS_AHEAD = 5;

// Detail-table labels that are on every page but aren't listing fields, so dropping them isn't drift.
const IGNORED_KEYS = new Set(['propertyNote']);

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

/** Required. Each line is trimmed with its spaces collapsed; the line breaks stay for parseAddress to split on. */
const address = () =>
  z
    .string({ error: 'Listing has no address' })
    .transform((value) =>
      value
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line)
        .join('\n'),
    )
    .pipe(z.string().min(1, 'Listing has no address'));

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

const money = (warn: Warn, field: string) => coerced(warn, field, 'not a dollar amount', toAmount);

const usDate = (warn: Warn, field: string) =>
  coerced(warn, field, `not a M/D/YYYY date from ${MIN_YEAR} to ${MAX_YEARS_AHEAD} years ahead`, toIsoDate);

// An unrecognised phone keeps its text: it's still useful to read, unlike a malformed amount or date.
const phone = (warn: Warn, field: string) =>
  coerced(warn, field, 'not a single US phone number', toPhone, (value) => value);

const listingDetailsSchema = (warn: Warn) =>
  z.object({
    address: address(),
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
    upsetAmount: money(warn, 'upsetAmount'),
  });

export type ScrapedListingDetails = z.output<ReturnType<typeof listingDetailsSchema>>;

const LISTING_FIELDS = new Set(Object.keys(listingDetailsSchema(() => undefined).shape));

/**
 * Validates and coerces a listing's detail-table values. Throws when the address is missing or blank; any other
 * field that can't be coerced is set per its rule and reported in `warnings`. Unknown keys are dropped with a warning.
 */
export const validateListingDetails = (
  raw: Record<string, string>,
): { details: ScrapedListingDetails; warnings: FieldWarning[] } => {
  const warnings: FieldWarning[] = Object.entries(raw)
    .filter(([key]) => !LISTING_FIELDS.has(key) && !IGNORED_KEYS.has(key))
    .map(([key, value]) => ({ field: key, value, reason: 'not a listing field' }));

  const result = listingDetailsSchema((warning) => warnings.push(warning)).safeParse(raw);

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
    const key = issue.path[0] as keyof RawStatusRow;

    warnings.push({ field: `statusHistory.${key}`, value: row[key], reason: issue.message });
  });

  return { rows: validRows, warnings };
};
