import { DateTime } from 'luxon';

// A foreclosure docket's year is its last two digits: `F-012441-25`, `F00258326`, Passaic's `F 012110 25 CTL#163224`,
// Burlington's `F-004124-25-B`, Atlantic's `SWC-F-000573-25`.
const SEPARATED = /\b[A-Z]{0,3}[- ]?\d{3,7}[- ](\d{2})(?![\d])/i;
const COMPACT = /\b[A-Z]{0,4}(\d{6,10})\b/i;

/** The four-digit year a docket number was filed in, or null when `courtCase` isn't a docket number. */
export const docketYear = (courtCase: string | null, now: DateTime = DateTime.utc()): number | null => {
  if (!courtCase) {
    return null;
  }

  const text = courtCase.trim();
  const yearDigits = SEPARATED.exec(text)?.[1] ?? COMPACT.exec(text)?.[1]?.slice(-2);

  if (!yearDigits) {
    return null;
  }

  const twoDigit = Number(yearDigits);
  const century = twoDigit <= (now.year % 100) + 1 ? 2000 : 1900;
  const year = century + twoDigit;

  return year >= 1990 && year <= now.year + 1 ? year : null;
};
