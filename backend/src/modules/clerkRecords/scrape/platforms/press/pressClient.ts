import axios, { AxiosInstance } from 'axios';
import { Agent } from 'https';
import { DateTime } from 'luxon';
import { parse } from 'node-html-parser';
import { rootCertificates } from 'tls';
import { NJCounty } from '../../../../../shared/nj';
import { validateClerkDocument } from '../../../parse/clerkDocumentSchema';
import { buildDocTypeMap, DocTypeMap } from '../../../parse/docCategory';
import {
  groupPressRows,
  parsePressResultGrid,
  PressGridRow,
} from '../../../parse/platforms/press/parsePressResultGrid';
import { createHostLimiter, HostBlockedError, HostLimiter, REQUEST_TIMEOUT_MS } from '../../hostLimiter';
import { ResultPage, saveResultPageToS3 } from '../../saveResultPageToS3';
import {
  ArchiveContext,
  ClerkDocumentRecord,
  ClerkIndexCoverage,
  ClerkPlatformClient,
  DateRange,
  DocCategory,
  InstrumentSearchInput,
  NameSearchInput,
  ParcelSearchInput,
  SearchResult,
} from '../../types';
import { isPlaceholderMunicipality, PRESS_COUNTIES, PressCountyConfig, resolveMunicipality } from './counties';

/** Pages fetched per search at most; a search with more is logged as truncated (design D9). */
export const MAX_RESULT_PAGES = 5;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

type Tab = 1 | 3 | 4;

type FormPage = {
  html: string;
  hidden: Record<string, string>;
};

/** Splits `[from, to]` into consecutive windows of at most `maxDays` days, oldest first. Both ends are inclusive. */
export const splitDateRange = (from: string, to: string, maxDays: number | null): Array<Required<DateRange>> => {
  const start = DateTime.fromISO(from, { zone: 'utc' });
  const end = DateTime.fromISO(to, { zone: 'utc' });

  if (!maxDays || end.diff(start, 'days').days < maxDays) {
    return [{ from, to }];
  }

  const windows: Array<Required<DateRange>> = [];

  for (let windowStart = start; windowStart <= end; windowStart = windowStart.plus({ days: maxDays })) {
    const windowEnd = DateTime.min(windowStart.plus({ days: maxDays - 1 }), end);
    windows.push({ from: windowStart.toISODate() as string, to: windowEnd.toISODate() as string });
  }

  return windows;
};

const toPressDate = (iso: string | undefined): string => (iso ? DateTime.fromISO(iso).toFormat('MM/dd/yyyy') : '');

const readHiddenFields = (html: string): Record<string, string> => {
  const fields: Record<string, string> = {};

  for (const input of parse(html).querySelectorAll('input[type=hidden]')) {
    const name = input.getAttribute('name');

    if (name) {
      fields[name] = input.getAttribute('value') ?? '';
    }
  }

  return fields;
};

const readOptions = (html: string, selectSuffix: string): string[] =>
  parse(html)
    .querySelector(`select[name$=${selectSuffix}]`)
    ?.querySelectorAll('option')
    .map((option) => option.getAttribute('value') ?? option.text.trim())
    .filter(Boolean) ?? [];

/** Merges documents a later window or doc type returned again, keeping every party. */
const mergeDocuments = (documents: ClerkDocumentRecord[]): ClerkDocumentRecord[] => {
  const byInstrument = new Map<string, ClerkDocumentRecord>();

  for (const document of documents) {
    const seen = byInstrument.get(document.instrumentNumber);

    if (!seen) {
      byInstrument.set(document.instrumentNumber, { ...document, parties: [...document.parties] });
      continue;
    }

    for (const party of document.parties) {
      if (!seen.parties.some(({ side, name }) => side === party.side && name === party.name)) {
        seen.parties.push(party);
      }
    }
  }

  return [...byInstrument.values()];
};

export type PressClientOptions = {
  http?: AxiosInstance;
  limiter?: HostLimiter;
  archive?: (page: ResultPage) => Promise<void>;
};

/**
 * A PRESS clerk portal for one county (press-scraping spec). Each search GETs the entry page for a fresh session and
 * form state, then posts the tab's fields, then pages through the results. Every request goes through the county
 * host's limiter. Create one per county per run.
 */
export class PressClient implements ClerkPlatformClient {
  public readonly platform = 'press' as const;

  public readonly county: NJCounty;

  public readonly coverage: ClerkIndexCoverage;

  private readonly http: AxiosInstance;

  private readonly limiter: HostLimiter;

  private readonly archive: (page: ResultPage) => Promise<void>;

  private readonly docTypes: DocTypeMap;

  private readonly cookies = new Map<string, string>();

  private readonly pageCounts = new Map<string, number>();

  private municipalities: string[] | null = null;

  public constructor(
    private readonly config: PressCountyConfig,
    options: PressClientOptions = {},
  ) {
    this.county = config.county;
    this.coverage = { parcelIndex: config.parcelIndex, parcelIndexStart: config.parcelIndexStart };
    this.docTypes = buildDocTypeMap(config.docTypes);
    this.limiter = options.limiter ?? createHostLimiter(new URL(config.entryUrl).host);
    this.archive = options.archive ?? saveResultPageToS3;
    this.http =
      options.http ??
      axios.create({
        timeout: REQUEST_TIMEOUT_MS,
        // A search never redirects; a redirect means the session or form state was refused.
        maxRedirects: 0,
        responseType: 'text',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US' },
        // Verification stays on; a configured intermediate only extends this host's trust store.
        httpsAgent: config.extraCa ? new Agent({ ca: [...rootCertificates, config.extraCa] }) : undefined,
      });
  }

  /** The PRESS client for a county, or undefined when the county isn't on PRESS. */
  public static forCounty(county: NJCounty, options?: PressClientOptions): PressClient | undefined {
    const config = PRESS_COUNTIES[county];

    return config ? new PressClient(config, options) : undefined;
  }

  public townCandidates(city: string | null): string[] {
    return resolveMunicipality(this.config, this.municipalities ?? [], city);
  }

  public async searchByName(input: NameSearchInput): Promise<SearchResult> {
    const fields = (window: DateRange, docType: string): Record<string, string> => ({
      txtLastNameTab1: input.lastName,
      txtFirstNameTab1: input.firstName ?? '',
      ddlDocTypeTab1: docType,
      txtFromTab1: toPressDate(window.from),
      txtToTab1: toPressDate(window.to),
      ddlShowRecTab1: this.config.rowsPerPage,
      ddlTotalRecTab1: this.config.totalRecords,
    });

    return this.searchEach(
      1,
      input,
      input.docCategories,
      fields,
      `name ${input.lastName} ${input.firstName ?? ''}`.trim(),
    );
  }

  public async searchByParcel(input: ParcelSearchInput): Promise<SearchResult> {
    return this.guard(async () => {
      // Load the dropdown first: an unresolved town sends no search.
      const entry = await this.getEntryPage();
      const municipality = this.townCandidates(input.municipality).find((label) =>
        this.municipalities?.includes(label),
      );

      if (!municipality) {
        console.warn(
          `${this.county} County: municipality ${JSON.stringify(input.municipality)} resolves to no PRESS dropdown option; skipping the block/lot search`,
        );

        return { kind: 'municipality_unresolved' as const, municipality: input.municipality };
      }

      const fields = (window: DateRange): Record<string, string> => ({
        ddlMunTab4: municipality,
        txtBlockTab4: input.block,
        txtLotTab4: input.lot,
        ...(this.config.qualifierField ? { txtQualifierTab4: input.qualifier ?? '' } : {}),
        txtFromTab4: toPressDate(window.from),
        txtToTab4: toPressDate(window.to),
        ddlShowRecTab4: this.config.rowsPerPage,
        ddlTotalRecTab4: this.config.totalRecords,
      });

      // PRESS's Block/Lot tab has no doc type field, so categories filter the results instead.
      const result = await this.searchEach(
        4,
        input,
        undefined,
        fields,
        `block/lot ${municipality} ${input.block}/${input.lot}`,
        entry,
      );

      if (result.kind !== 'documents' || !input.docCategories?.length) {
        return result;
      }

      const wanted = new Set<DocCategory>(input.docCategories);

      return { ...result, documents: result.documents.filter(({ docCategory }) => wanted.has(docCategory)) };
    });
  }

  public async searchByInstrument(input: InstrumentSearchInput): Promise<SearchResult> {
    const fields = (): Record<string, string> => ({ txtInstrumentTab3: input.instrumentNumber });

    return this.searchEach(3, { archive: input.archive }, undefined, fields, `instrument ${input.instrumentNumber}`);
  }

  /** Turns a blocked host into the `blocked` result; other failures propagate to the caller. */
  private async guard(search: () => Promise<SearchResult>): Promise<SearchResult> {
    try {
      return await search();
    } catch (error) {
      if (error instanceof HostBlockedError) {
        return { kind: 'blocked' };
      }

      throw error;
    }
  }

  /**
   * Runs one search per doc type value and date window, oldest window first, and unions their documents. No doc
   * categories means one search across every type; no dates means one search over the whole index.
   */
  private async searchEach(
    tab: Tab,
    input: DateRange & { archive?: ArchiveContext },
    docCategories: DocCategory[] | undefined,
    fields: (window: DateRange, docType: string) => Record<string, string>,
    description: string,
    firstEntry?: FormPage,
  ): Promise<SearchResult> {
    return this.guard(async () => {
      const docTypeValues = docCategories?.length
        ? [...new Set(docCategories.flatMap((category) => this.docTypes.optionValuesFor(category)))]
        : [''];
      const windows: DateRange[] =
        input.from && input.to ? splitDateRange(input.from, input.to, this.config.maxWindowDays) : [input];
      const documents: ClerkDocumentRecord[] = [];
      const unmapped = new Set<string>();
      let truncated = false;
      let entry = firstEntry;

      for (const window of windows) {
        for (const docType of docTypeValues) {
          const result = await this.runSearch(tab, fields(window, docType), input.archive, description, entry);
          entry = undefined;
          documents.push(...result.documents);
          result.unmapped.forEach((description) => unmapped.add(description));
          truncated ||= result.truncated;
        }
      }

      return { kind: 'documents', documents: mergeDocuments(documents), unmappedDocTypes: [...unmapped], truncated };
    });
  }

  private async runSearch(
    tab: Tab,
    tabFields: Record<string, string>,
    archive: ArchiveContext | undefined,
    description: string,
    entry?: FormPage,
  ): Promise<{ documents: ClerkDocumentRecord[]; unmapped: string[]; truncated: boolean }> {
    const prefix = this.config.fieldPrefix;
    const form = entry ?? (await this.getEntryPage());
    const body: Record<string, string> = {
      ...form.hidden,
      __EVENTTARGET: '',
      __EVENTARGUMENT: '',
      hidCurrTab: String(tab),
    };

    for (const [name, value] of Object.entries(tabFields)) {
      body[`${prefix}${name}`] = value;
    }

    body[`${prefix}btnSearchTab${tab}`] = 'Search';

    if (this.config.newSearchFlag) {
      body.hidDiv = 'NewSearch';
    }

    const context = `${this.county} County ${description}`;
    const rows: PressGridRow[] = [];
    let html = await this.post(body);
    let pagesFetched = 0;
    let truncated = false;

    for (;;) {
      pagesFetched++;
      await this.archivePage(archive, html);

      const page = parsePressResultGrid(html, context);

      if (page.kind === 'no_records') {
        break;
      }

      rows.push(...page.rows);

      const next = page.pager.pageTargets.get(page.pager.currentPage + 1) ?? page.pager.moreTarget;

      if (!next) {
        break;
      }

      if (pagesFetched >= MAX_RESULT_PAGES) {
        truncated = true;
        // PRESS shows no total row count, so the log gives what was fetched and that more pages remain.
        console.warn(
          `${context}: stopped after ${MAX_RESULT_PAGES} pages (${rows.length} rows); the portal shows more pages and no total`,
        );
        break;
      }

      const pageBody: Record<string, string> = {
        ...readHiddenFields(html),
        __EVENTTARGET: next,
        __EVENTARGUMENT: '',
      };

      if (this.config.newSearchFlag) {
        pageBody.hidDiv = '';
      }

      html = await this.post(pageBody);
    }

    return { ...this.toRecords(rows, context), truncated };
  }

  private toRecords(rows: PressGridRow[], context: string): { documents: ClerkDocumentRecord[]; unmapped: string[] } {
    const { documents, keyless } = groupPressRows(rows);
    const records: ClerkDocumentRecord[] = [];
    const unmapped = new Set<string>();

    keyless.forEach((row) =>
      console.warn(`${context}: rejected a ${row.type} row with no instrument number or book/page`),
    );

    for (const document of documents) {
      const validation = validateClerkDocument(document, {
        county: this.county,
        platform: this.platform,
        docTypes: this.docTypes,
      });

      if (!validation.ok) {
        console.warn(
          `${context}: rejected document ${document.instrumentNumber ?? '(no instrument)'}: ${validation.reason}`,
        );
        continue;
      }

      validation.warnings.forEach(({ instrumentNumber, field, value, reason }) =>
        console.warn(`${context}: document ${instrumentNumber} ${field} ${JSON.stringify(value)} is ${reason}`),
      );

      if (validation.unmappedDocType) {
        unmapped.add(validation.unmappedDocType);
      }

      records.push(validation.record);
    }

    return { documents: records, unmapped: [...unmapped] };
  }

  private async archivePage(archive: ArchiveContext | undefined, html: string): Promise<void> {
    const listingId = archive?.listingId ?? 'search';
    const step = archive?.step ?? 'adhoc';
    const key = `${listingId}-${step}`;
    const n = (this.pageCounts.get(key) ?? 0) + 1;

    this.pageCounts.set(key, n);
    await this.archive({ county: this.county, listingId, step, n, html });
  }

  /** GETs the entry page for a fresh session and form state. The first one also checks the config against it. */
  private async getEntryPage(): Promise<FormPage> {
    const html = await this.request('GET');

    if (!this.municipalities) {
      this.checkLiveOptions(html);
    }

    return { html, hidden: readHiddenFields(html) };
  }

  /** Warns about alias targets and doc type values the live dropdowns no longer offer (design D8). */
  private checkLiveOptions(html: string): void {
    this.municipalities = readOptions(html, 'ddlMunTab4').filter((label) => !isPlaceholderMunicipality(label));

    const live = new Set(this.municipalities);
    const missingTowns = [...new Set(Object.values(this.config.municipalityAliases).flat())].filter(
      (label) => !live.has(label),
    );

    if (missingTowns.length > 0) {
      console.warn(
        `${this.county} County: alias targets missing from the live municipality dropdown, so their block/lot ` +
          `searches are skipped: ${missingTowns.join(', ')}`,
      );
    }

    const liveDocTypes = new Set(readOptions(html, 'ddlDocTypeTab1'));
    const missingDocTypes = this.config.docTypes.filter(([value]) => !liveDocTypes.has(value));

    if (liveDocTypes.size > 0 && missingDocTypes.length > 0) {
      console.warn(
        `${this.county} County: doc types missing from the live dropdown: ${missingDocTypes
          .map(([value, label]) => `${value} (${label})`)
          .join(', ')}`,
      );
    }
  }

  private post(body: Record<string, string>): Promise<string> {
    return this.request('POST', new URLSearchParams(body).toString());
  }

  private async request(method: 'GET' | 'POST', body?: string): Promise<string> {
    return this.limiter.run(async () => {
      const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
      const response = await this.http.request<string>({
        method,
        url: this.config.entryUrl,
        data: body,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', Referer: this.config.entryUrl } : {}),
        },
        validateStatus: (status) => status >= 200 && status < 300,
      });

      for (const setCookie of ([] as string[]).concat(response.headers['set-cookie'] ?? [])) {
        const [pair] = setCookie.split(';');
        const separator = pair.indexOf('=');

        if (separator > 0) {
          this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
        }
      }

      return response.data;
    });
  }
}
