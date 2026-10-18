import { DateTime } from 'luxon';
import { z } from 'zod';
import { NJCounty } from '../../../shared/nj';
import { ClerkDocumentRecord, ClerkPlatform } from '../scrape/types';
import { DocTypeMap, refineDeedCategory } from './docCategory';
import { normalizeName } from './normalizeName';
import { PressDocumentRows } from './platforms/press/parsePressResultGrid';

/** A grid value the schema dropped or kept with doubts; logged, never fatal (as in listing-validation). */
export type ClerkFieldWarning = { instrumentNumber: string; field: string; value: string; reason: string };

export type ClerkDocumentValidation =
  | { ok: true; record: ClerkDocumentRecord; warnings: ClerkFieldWarning[]; unmappedDocType: string | null }
  | { ok: false; reason: string };

// PRESS dates are `M/D/YYYY`; nothing in a clerk index predates the county.
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const MIN_YEAR = 1700;

const toIsoDate = (value: string | null): string | null => {
  const match = value ? US_DATE_RE.exec(value.trim()) : null;

  if (!match) {
    return null;
  }

  const date = DateTime.utc(Number(match[3]), Number(match[1]), Number(match[2]));

  return date.isValid && date.year >= MIN_YEAR && date <= DateTime.utc().plus({ days: 1 }) ? date.toISODate() : null;
};

// `OR-9597`, `MB-4786`, `M3873`, `AS92` carry a book type; Essex's `12000` doesn't.
const BOOK_RE = /^([A-Z]+)-?(\d+[A-Z]?)$/i;

const splitBook = (book: string | null): { bookType: string | null; book: string | null } => {
  const match = book ? BOOK_RE.exec(book) : null;

  return match ? { bookType: match[1].toUpperCase(), book: match[2] } : { bookType: null, book };
};

const PARCEL_VALUE_RE = /^[0-9A-Z][0-9A-Z.\-/ ]{0,19}$/i;

const groupedSchema = z.object({
  docTypeRaw: z.string().trim().min(1),
  direct: z.array(z.string().trim().min(1)),
  indirect: z.array(z.string().trim().min(1)),
});

export type ValidateClerkDocumentArgs = {
  county: NJCounty;
  platform: ClerkPlatform;
  docTypes: DocTypeMap;
};

/**
 * Validates one grouped document (design D4). A document with no instrument number and no book/page, or with no
 * parseable recorded date, is rejected. A block or lot that doesn't look like one is dropped with a warning.
 */
export const validateClerkDocument = (
  rows: PressDocumentRows,
  { county, platform, docTypes }: ValidateClerkDocumentArgs,
): ClerkDocumentValidation => {
  const instrumentNumber =
    rows.instrumentNumber ?? (rows.book && rows.page ? `BK:${rows.book}/${rows.page}` : null);

  if (!instrumentNumber) {
    return { ok: false, reason: 'no instrument number and no book/page' };
  }

  const recordedDate = toIsoDate(rows.recorded);

  if (!recordedDate) {
    return { ok: false, reason: `recorded date ${JSON.stringify(rows.recorded)} is not a date` };
  }

  const parsed = groupedSchema.safeParse(rows);

  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') };
  }

  const warnings: ClerkFieldWarning[] = [];
  const parcelValue = (field: string, value: string | null) => {
    if (value && !PARCEL_VALUE_RE.test(value)) {
      warnings.push({ instrumentNumber, field, value, reason: 'not a block/lot value' });

      return null;
    }

    return value;
  };

  if (parsed.data.direct.length === 0 && parsed.data.indirect.length === 0) {
    warnings.push({ instrumentNumber, field: 'parties', value: '', reason: 'no parties' });
  }

  const { category, mapped } = docTypes.categoryOf(parsed.data.docTypeRaw);
  const { bookType, book } = splitBook(rows.book);
  const block = parcelValue('block', rows.block);
  const lot = block ? parcelValue('lot', rows.lot) : null;

  const record: ClerkDocumentRecord = {
    county,
    platform,
    instrumentNumber,
    docCategory: refineDeedCategory(category, parsed.data.direct),
    docTypeRaw: parsed.data.docTypeRaw,
    recordedDate,
    bookType,
    book,
    page: rows.page,
    municipality: rows.town,
    block,
    lot,
    qualifier: rows.qualifier,
    extraLots: lot ? rows.extraLots.filter((extra) => PARCEL_VALUE_RE.test(extra)) : [],
    consideration: null,
    detail: null,
    parties: [
      ...parsed.data.direct.map((name) => ({ side: 'direct' as const, name })),
      ...parsed.data.indirect.map((name) => ({ side: 'indirect' as const, name })),
    ].filter(({ name }) => normalizeName(name)),
    links: [],
  };

  return { ok: true, record, warnings, unmappedDocType: mapped ? null : parsed.data.docTypeRaw };
};
