// Party names as listings and clerk indexes write them. Listings say "John A. Smith" and "U.S. Bank National
// Association, as Trustee for …"; clerks say "SMITH JOHN A" and "U S BANK NATIONAL ASSOCIATION". See design D6.

/** Entity names match when their token sets' Jaccard similarity reaches this. */
export const ENTITY_MATCH_THRESHOLD = 0.8;

// A name-ending phrase that describes the party's capacity rather than naming it. Everything from it on is dropped.
const ROLE_TAIL =
  /\b(?:AS\s+(?:OWNER\s+|INDENTURE\s+|SUCCESSOR\s+|CO\s+)*(?:TRUSTEE|EXECUT(?:OR|RIX)|ADMINISTRAT(?:OR|RIX)|NOMINEE|SERVICER|ATTORNEY|AGENT|CUSTODIAN|HEIR|BENEFICIARY|PERSONAL\s+REPRESENTATIVE|SUCCESSOR)|NOT\s+IN\s+ITS\s+INDIVIDUAL|SOLELY\s+AS|INDIVIDUALLY|SUCCESSOR\s+(?:BY|IN|TO)|F\s*K\s*A|A\s*K\s*A|D\s*B\s*A|FORMERLY\s+KNOWN)\b.*$/;
const ET_AL = /\bET\s+(?:ALS?|UX|VIR)\b.*$/;
const SPOUSE_PHRASES = /\b(?:H\s*W|HIS\s+WIFE|HER\s+HUSBAND|HUSBAND\s+AND\s+WIFE|WIFE\s+AND\s+HUSBAND|DECEASED)\b/g;
const MERS_NOMINEE = /^.*\bMORTGAGE\s+ELEC(?:TRONIC)?\s+REGISTRATION\s+SYS(?:TEMS?)?\b(?:\s+INC)?\s+AS\s+NOMINEE\s+FOR\s+/;
const MERS = /\bMORTGAGE\s+ELEC(?:TRONIC)?\s+REGISTRATION\s+SYS(?:TEMS?)?(?:\s+INC)?\b/;
const NATIONAL_ASSOCIATION_TAIL = /\bNATIONAL\s+ASSOCIATION$/;
const ENTITY_SUFFIX_TAIL = /(?:\s+(?:LLC|L\s+L\s+C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|NA|N\s+A|FSB|LP|LLP|LTD|PLLC|PC))+$/;

// Clerks abbreviate; listings mostly don't.
const ABBREVIATIONS: Record<string, string> = {
  MTG: 'MORTGAGE',
  MTGE: 'MORTGAGE',
  NATL: 'NATIONAL',
  ASSN: 'ASSOCIATION',
  ASSOC: 'ASSOCIATION',
  BK: 'BANK',
  FIN: 'FINANCIAL',
  FINL: 'FINANCIAL',
  SVCS: 'SERVICES',
  SVCG: 'SERVICING',
  SERV: 'SERVICES',
  SVGS: 'SAVINGS',
  INVT: 'INVESTMENT',
  FED: 'FEDERAL',
  TR: 'TRUST',
  TRST: 'TRUST',
  CTR: 'CENTER',
  HLDGS: 'HOLDINGS',
  MGMT: 'MANAGEMENT',
  ELEC: 'ELECTRONIC',
};

const GENERATIONAL = new Set(['JR', 'SR', 'II', 'III', 'IV']);

// Words that only an organisation's name carries.
const ENTITY_WORDS =
  /\b(?:LLC|INC|CORP|CORPORATION|COMPANY|CO|NA|FSB|LP|LLP|LTD|BANK|BANCORP|TRUST|TRUSTEE|ASSOCIATION|MORTGAGE|MERS|FUND|FUNDING|CAPITAL|SERVICING|SERVICES|LOAN|LOANS|LENDING|FINANCIAL|FINANCE|SAVINGS|CREDIT|UNION|HOLDINGS|PARTNERS|PARTNERSHIP|AUTHORITY|STATE|COUNTY|CITY|TOWNSHIP|BOROUGH|UNITED|AMERICA|ASSET|ASSETS|ACCEPTANCE|INVESTMENT|INVESTMENTS|INVESTORS|REALTY|PROPERTIES|PROPERTY|DEVELOPMENT|CONDOMINIUM|HOMEOWNERS|FEDERAL|NATIONAL|MANAGEMENT|GROUP|ENTERPRISES|SECRETARY|DEPARTMENT|HOUSING|SOCIETY|COOPERATIVE|REVITALIZATION|FAMILY|ESTATE)\b/;

// Defendants named only so the foreclosure binds them, who aren't the borrower or owner.
const NOT_A_PARTY =
  /^(?:SPOUSE\s+OF\b|MR\b|MRS\b|MS\b|UNKNOWN\b|JOHN\s+DOE\b|JANE\s+DOE\b|THE\s+UNKNOWN\b|OCCUPANTS?\b|TENANTS?\b|STATE\s+OF\s+NEW\s+JERSEY\b|NEW\s+JERSEY\s+STATE\b|UNITED\s+STATES\b|THE\s+UNITED\s+STATES\b|CITY\s+OF\b|TOWNSHIP\s+OF\b|BOROUGH\s+OF\b|COUNTY\s+OF\b)/;

/** Uppercases, turns punctuation into spaces and collapses whitespace. `U.S.` becomes `U S`. */
const cleanText = (name: string): string =>
  name
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Joins a run of single letters at the start of an entity name: `U S BANK` → `US BANK`, `J P MORGAN` → `JP MORGAN`. */
const joinLeadingInitials = (name: string): string => {
  const tokens = name.split(' ');
  let run = 0;

  while (run < tokens.length && tokens[run].length === 1) {
    run++;
  }

  return run >= 2 ? [tokens.slice(0, run).join(''), ...tokens.slice(run)].join(' ') : name;
};

export const isEntityName = (name: string): boolean => ENTITY_WORDS.test(cleanText(name));

/**
 * The comparable form of a party name: uppercased, punctuation and capacity phrases removed, abbreviations expanded,
 * entity suffixes removed. A MERS-as-nominee phrase becomes the nominee. Stored on every ClerkDocumentParty row.
 */
export const normalizeName = (name: string): string => {
  let text = cleanText(name);

  if (MERS_NOMINEE.test(text)) {
    text = text.replace(MERS_NOMINEE, '');
  }

  text = text.replace(ROLE_TAIL, '').replace(ET_AL, '').replace(SPOUSE_PHRASES, ' ');
  text = text
    .split(' ')
    .filter(Boolean)
    .map((token) => ABBREVIATIONS[token] ?? token)
    .join(' ');
  text = text.replace(MERS, 'MERS').replace(/\bTHE\b/g, ' ').replace(/\s+/g, ' ').trim();

  if (ENTITY_WORDS.test(text)) {
    text = joinLeadingInitials(text).replace(NATIONAL_ASSOCIATION_TAIL, '').trim();
    text = text.replace(ENTITY_SUFFIX_TAIL, '').trim();
  }

  return text;
};

const tokenSet = (normalized: string): Set<string> => new Set(normalized.split(' ').filter(Boolean));

const jaccard = (a: Set<string>, b: Set<string>): number => {
  const union = new Set([...a, ...b]);
  const shared = [...a].filter((token) => b.has(token)).length;

  return union.size === 0 ? 0 : shared / union.size;
};

/**
 * Person names match when their names (tokens longer than one letter, other than JR/SR/II…) are the same set, in any
 * order. An initial or generational suffix only one side gives is ignored; when both give one, they must agree.
 */
const personNamesMatch = (a: Set<string>, b: Set<string>): boolean => {
  const split = (tokens: Set<string>) => {
    const names = [...tokens].filter((token) => token.length > 1 && !GENERATIONAL.has(token)).sort();
    const initials = [...tokens].filter((token) => token.length === 1).sort();
    const generation = [...tokens].filter((token) => GENERATIONAL.has(token)).sort();

    return { names: names.join(' '), initials: initials.join(' '), generation: generation.join(' ') };
  };
  const left = split(a);
  const right = split(b);

  if (!left.names || left.names !== right.names) {
    return false;
  }

  const agree = (x: string, y: string) => !x || !y || x === y;

  return agree(left.initials, right.initials) && agree(left.generation, right.generation);
};

/** Whether two party names, raw or normalized, name the same party. See design D6. */
export const namesMatch = (a: string, b: string, threshold = ENTITY_MATCH_THRESHOLD): boolean => {
  const left = normalizeName(a);
  const right = normalizeName(b);

  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);

  if (isEntityName(left) || isEntityName(right)) {
    return jaccard(leftTokens, rightTokens) >= threshold;
  }

  return personNamesMatch(leftTokens, rightTokens);
};

/** Whether any name in `names` matches any name in `others`. */
export const anyNameMatches = (names: string[], others: string[]): boolean =>
  names.some((name) => others.some((other) => namesMatch(name, other)));

export type Defendant = {
  /** The name as the listing gives it, trimmed. */
  name: string;
  isEntity: boolean;
};

/** Removes the capacity phrases that a listing's defendant text attaches to a name, keeping its punctuation. */
const stripDefendantRoles = (part: string): string =>
  part
    .replace(/,?\s*\b(?:individually|as\s+(?:co-?)?(?:execut|administrat|trustee|heir|personal)|et\.?\s*(?:als?|ux|vir)\b|a\/?k\/?a\b|f\/?k\/?a\b|his\s+wife|her\s+husband|h\/w\b|husband\s+and\s+wife|deceased).*$/i, '')
    .replace(/[,.\s]+$/, '')
    .trim();

/**
 * Splits a listing's `defendant` text into its defendants. Splits on `;` and `:`, then on ` AND ` and ` & ` between
 * people, then on `, ` when every piece is a full name — so `SMITH, JOHN` stays one name. Drops parties named only so
 * the judgment binds them: spouses of, unknown heirs, the State and the United States.
 */
export const splitDefendants = (defendant: string | null): Defendant[] => {
  if (!defendant) {
    return [];
  }

  const names = defendant
    .replace(/,(?=\S)/g, ', ')
    .split(/[;:]/)
    .map(stripDefendantRoles)
    .flatMap((part) => (isEntityName(part) && !/\s&\s|\sand\s/i.test(part) ? [part] : part.split(/\s+(?:and|&)\s+/i)))
    .map(stripDefendantRoles)
    .flatMap((part) => {
      const pieces = part.split(/,\s+/).map((piece) => piece.trim());
      const allFullNames = pieces.every((piece) => piece.split(/\s+/).length >= 2);

      return pieces.length > 1 && allFullNames ? pieces : [part];
    })
    .map((part) => part.trim())
    .filter((part) => part && !NOT_A_PARTY.test(cleanText(part)) && normalizeName(part));

  const seen = new Set<string>();

  return names
    .filter((name) => {
      const key = normalizeName(name);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    })
    .map((name) => ({ name, isEntity: isEntityName(name) }));
};

export type NameSearchTerm = { lastName: string; firstName?: string };

/**
 * The term to search the clerk's index with for a defendant: a person's surname and first given name, or an entity's
 * whole normalized name. PRESS matches the first name as a prefix and treats it as optional (design, spike findings).
 */
export const searchTermFor = (defendant: Defendant): NameSearchTerm => {
  if (defendant.isEntity) {
    return { lastName: normalizeName(defendant.name) };
  }

  // `SMITH, JOHN` lists the surname first; `John A. Smith Jr.` lists it last.
  const commaForm = /^([^,]+),\s*(.+)$/.exec(defendant.name);
  const tokens = normalizeName(commaForm ? `${commaForm[2]} ${commaForm[1]}` : defendant.name)
    .split(' ')
    .filter((token) => !GENERATIONAL.has(token));

  if (tokens.length < 2) {
    return { lastName: tokens[0] ?? '' };
  }

  const lastName = tokens[tokens.length - 1];
  const firstName = tokens.find((token) => token.length > 1 && token !== lastName);

  return firstName ? { lastName, firstName } : { lastName };
};

/** The defendant to search for: the first person, or the first entity when there are no people. */
export const primaryDefendant = (defendants: Defendant[]): Defendant | undefined =>
  defendants.find((defendant) => !defendant.isEntity) ?? defendants[0];
