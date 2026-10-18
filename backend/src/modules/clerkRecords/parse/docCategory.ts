import { DocCategory } from '../scrape/types';

// Doc type descriptions → canonical categories (design D3). PRESS shows the dropdown label in the grid's Type column,
// and the labels differ by county ("FORECLOSURE LIS PENDENS", "LIS PENDENS FORECLOSURE AND RECOVERY", "DEEDS From
// 10/01/1996 to Present"), so the rules below run over each county's labels to build its map.

type Rule = { test: RegExp; unless?: RegExp; category: DocCategory | ((description: string) => DocCategory) };

const RULES: Rule[] = [
  {
    test: /\bLIS\b|LIS\s*PEND|LISPEN/,
    category: (description) => (/DISCHARG|RELEAS/.test(description) ? 'LIS_PENDENS_DISCHARGE' : 'LIS_PENDENS'),
  },
  { test: /SHERIFF'?S?\s+DEED/, category: 'SHERIFF_DEED' },
  { test: /FINAL\s+JUDG/, category: 'FINAL_JUDGMENT' },
  { test: /TAX\s+SALE/, category: 'TAX_SALE_CERTIFICATE' },
  {
    test: /NOTICE\s+OF\s+SETTLEMENT|NOTICE\/SETTLEMENT/,
    category: (description) => (/DISCHARG/.test(description) ? 'OTHER' : 'NOTICE_OF_SETTLEMENT'),
  },
  {
    test: /MORTGAGE|\bMTG\b/,
    unless: /LEASE|RENT|UCC|SECURITY\s+AGREEMENT|COMMITMENT/,
    category: (description) => {
      if (/ASSIGN/.test(description)) {
        return 'MORTGAGE_ASSIGNMENT';
      }

      if (/DISCHARG|CANCEL|RELEAS|SATISF/.test(description)) {
        return 'MORTGAGE_DISCHARGE';
      }

      if (/MODIF|AMEND|EXTENSION|SUBORDINAT|POSTPONE|ASSUMPTION|CONSOLIDATION|CORRECTION/.test(description)) {
        return 'MORTGAGE_MODIFICATION';
      }

      return /^(?:SUPPLEMENTAL\s+)?MORTGAGES?\b/.test(description) ? 'MORTGAGE' : 'OTHER';
    },
  },
  {
    test: /^(?:DEEDS?\b|DEED-|MUNICIPAL\s+DEED|MARSHALS?\s+DEED|CORRECTION\s+TO\s+DEED)/,
    unless: /LEASE|DEDICATION|MASTER|EASEMENT|RESTRICTION/,
    category: 'DEED',
  },
  { test: /LIEN/, unless: /RELEAS|DISCHARG|WITHDRAW|WAIVER|SATISF|REVOC|REVOK|CANCEL|BOND|AMEND|PARTIAL/, category: 'LIEN' },
];

/** The category a doc type description belongs to; OTHER when no rule claims it. */
export const classifyDocType = (description: string): DocCategory => {
  const text = description.replace(/\s+/g, ' ').trim().toUpperCase();

  for (const rule of RULES) {
    if (rule.test.test(text) && !rule.unless?.test(text)) {
      return typeof rule.category === 'function' ? rule.category(text) : rule.category;
    }
  }

  return 'OTHER';
};

/** A county's doc types: description → category, and category → the dropdown option values that select it. */
export type DocTypeMap = {
  categoryOf(description: string): { category: DocCategory; mapped: boolean };
  optionValuesFor(category: DocCategory): string[];
};

export const buildDocTypeMap = (options: ReadonlyArray<readonly [value: string, label: string]>): DocTypeMap => {
  const byLabel = new Map<string, DocCategory>();
  const valuesByCategory = new Map<DocCategory, string[]>();

  for (const [value, label] of options) {
    const key = label.replace(/\s+/g, ' ').trim().toUpperCase();
    const category = classifyDocType(key);

    byLabel.set(key, category);
    valuesByCategory.set(category, [...(valuesByCategory.get(category) ?? []), value]);
  }

  return {
    // A description missing from the county's dropdown is stored as OTHER and reported, so gaps show up in the logs.
    categoryOf: (description) => {
      const category = byLabel.get(description.replace(/\s+/g, ' ').trim().toUpperCase());

      return category ? { category, mapped: true } : { category: 'OTHER', mapped: false };
    },
    optionValuesFor: (category) => valuesByCategory.get(category) ?? [],
  };
};

const SHERIFF_GRANTOR = /\bSHERIFF\b/;

/**
 * Only Burlington has a sheriff's deed doc type; elsewhere it's indexed as a DEED from the county sheriff. A deed whose
 * grantor names a sheriff is a sheriff's deed.
 */
export const refineDeedCategory = (category: DocCategory, directParties: string[]): DocCategory =>
  category === 'DEED' && directParties.some((party) => SHERIFF_GRANTOR.test(party.toUpperCase())) ? 'SHERIFF_DEED' : category;
