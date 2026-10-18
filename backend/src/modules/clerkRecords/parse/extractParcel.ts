// Block and lot from a listing's `parcel` and `description` text. See design D7.

export type Parcel = {
  block: string;
  lot: string;
  extraLots: string[];
  qualifier: string | null;
};

// `20.13`, `2187.01`, `5`, `18-B`, `28.A`
const VALUE = String.raw`\d+(?:\.\d+)?(?:-?[A-Z](?![A-Z]))?`;
const LOT_WORD = String.raw`(?:TAX\s+)?(?:LOTS?\(S\)|LOTS?|LT\.?|LTS\.?)(?:\s+NOS?\.?)?\s*[:#]?\s*`;
const BLOCK_WORD = String.raw`(?:TAX\s+)?(?:BLOCK|BLK\.?)(?:\s+NO\.?)?\s*[:#]?\s*`;
// A lot list: `6`, `21 & 22`, `5.01 AND 5.02`, `3-4`, `6, ADDITIONAL LOTS 12, 18-B`, with `fka`/`(aka …)` asides.
const LOT_LIST = String.raw`${VALUE}(?:\s*(?:,|&|AND|TO|-|,?\s*ADDITIONAL\s+LOTS?)\s*${VALUE})*`;
const FORMERLY = String.raw`(?:FKA|AKA|F\/K\/A|A\/K\/A)\s+(?:(?:LOTS?|BLOCK)\s+)?[\w.-]+(?:\s*(?:&|AND|,)\s*\d[\w.-]*)*`;
const QUALIFIER_ASIDE = String.raw`QUAL(?:IFIER)?\.?(?:\s+NO\.?)?\s*:?\s*[A-Z0-9.]+|C\.?\d{3,4}[A-Z]?`;
const ASIDE = String.raw`(?:\s*,?\s*(?:\((?:[^()]{0,40})\)|${FORMERLY}|${QUALIFIER_ASIDE}))*`;

const LOT_THEN_BLOCK = new RegExp(
  String.raw`\b${LOT_WORD}(?<lots>${LOT_LIST})${ASIDE}\s*[,;]?\s*(?:IN\s+|ON\s+)?${BLOCK_WORD}(?<block>${VALUE})(?<after>${ASIDE})`,
  'gi',
);
const BLOCK_THEN_LOT = new RegExp(
  String.raw`\b${BLOCK_WORD}(?<block>${VALUE})${ASIDE}\s*[,;]?\s*(?:AND\s+)?${LOT_WORD}(?<lots>${LOT_LIST})(?<after>${ASIDE})`,
  'gi',
);
const QUALIFIER = /\b(?:QUAL(?:IFIER)?\.?(?:\s+NO\.?)?\s*:?\s*([A-Z0-9.]+)|(C\.?\d{3,4}[A-Z]?)\b)/i;

// Metes-and-bounds descriptions name the neighbours' lots: "ALONG THE LINE OF LOT: 7 IN BLOCK: 1104". A match right
// after these words describes a boundary, not the property.
const BOUNDARY_CONTEXT = /\b(?:LINE|LINES|ALONG|BETWEEN|ADJOINING|CORNER|DIVIDING|DIVISION|BOUNDED|THENCE)\b[^.;]{0,30}$/i;

const splitLots = (lots: string): string[] =>
  lots
    .replace(/ADDITIONAL\s+LOTS?/gi, ',')
    .split(/\s*(?:,|&|\bAND\b)\s*/i)
    .flatMap((lot) => {
      // `3-4` is a range of two lots; `18-B` is one lot.
      const range = /^(\d+)\s*(?:-|TO)\s*(\d+)$/i.exec(lot);

      return range ? [range[1], range[2]] : [lot];
    })
    .map((lot) => lot.trim().toUpperCase())
    .filter(Boolean);

const findIn = (text: string): Parcel | null => {
  const candidates: Array<{ index: number; parcel: Parcel }> = [];

  for (const pattern of [LOT_THEN_BLOCK, BLOCK_THEN_LOT]) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;

      if (BOUNDARY_CONTEXT.test(text.slice(Math.max(0, index - 60), index))) {
        continue;
      }

      const { lots = '', block = '' } = match.groups ?? {};
      const [lot, ...extraLots] = splitLots(lots);
      // A former qualifier (`fka C0309`) isn't the current one.
      const current = match[0].replace(new RegExp(String.raw`\((?:[^()]{0,40})\)|${FORMERLY}`, 'gi'), ' ');
      const qualifierMatch = QUALIFIER.exec(current);
      const qualifier = (qualifierMatch?.[1] ?? qualifierMatch?.[2])?.replace(/\./g, '').toUpperCase() ?? null;

      if (lot && block) {
        candidates.push({ index, parcel: { block: block.toUpperCase(), lot, extraLots, qualifier } });
      }
    }
  }

  candidates.sort((a, b) => a.index - b.index);

  return candidates[0]?.parcel ?? null;
};

/**
 * Finds the listing's block and lot in its `parcel` text, then in its `description`. Returns null for text that names
 * no parcel, such as Burlington's sale-notice disclaimer.
 */
export const extractParcel = (parcel: string | null, description: string | null): Parcel | null =>
  (parcel ? findIn(parcel) : null) ?? (description ? findIn(description) : null);

/** A block or lot in comparable form: uppercased, without leading zeros in its integer part. `049.04` → `49.04`. */
export const normalizeParcelValue = (value: string): string =>
  value
    .trim()
    .toUpperCase()
    .replace(/^0+(?=\d)/, '');

/** Whether two block/lot pairs name the same parcel. A lot matches the other side's lot or any of its extra lots. */
export const sameParcel = (
  a: { block: string | null; lot: string | null; extraLots?: string[] },
  b: { block: string | null; lot: string | null; extraLots?: string[] },
): boolean => {
  if (!a.block || !a.lot || !b.block || !b.lot) {
    return false;
  }

  if (normalizeParcelValue(a.block) !== normalizeParcelValue(b.block)) {
    return false;
  }

  const lots = (parcel: typeof a) => [parcel.lot as string, ...(parcel.extraLots ?? [])].map(normalizeParcelValue);
  const right = new Set(lots(b));

  return lots(a).some((lot) => right.has(lot));
};
