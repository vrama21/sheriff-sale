import { describe, expect, it } from 'vite-plus/test';
import { ESSEX_DOC_TYPES } from '../scrape/platforms/press/docTypeOptions';
import { validateClerkDocument } from './clerkDocumentSchema';
import { buildDocTypeMap } from './docCategory';
import { PressDocumentRows } from './platforms/press/parsePressResultGrid';

const args = { county: 'Essex' as const, platform: 'press' as const, docTypes: buildDocTypeMap(ESSEX_DOC_TYPES) };

const rows = (overrides: Partial<PressDocumentRows>): PressDocumentRows => ({
  instrumentNumber: '6165788',
  docTypeRaw: 'DEED',
  recorded: '11/15/2006',
  town: 'LIVINGSTON',
  block: '2602',
  lot: '47',
  extraLots: [],
  qualifier: null,
  book: '12000',
  page: '1529',
  direct: ['HAMILTON ANDREW'],
  indirect: ['BONVINI MARCELLO'],
  ...overrides,
});

describe('validateClerkDocument', () => {
  it('builds a record with ISO dates, categories and sided parties', () => {
    expect(validateClerkDocument(rows({}), args)).toEqual({
      ok: true,
      unmappedDocType: null,
      warnings: [],
      record: {
        county: 'Essex',
        platform: 'press',
        instrumentNumber: '6165788',
        docCategory: 'DEED',
        docTypeRaw: 'DEED',
        recordedDate: '2006-11-15',
        bookType: null,
        book: '12000',
        page: '1529',
        municipality: 'LIVINGSTON',
        block: '2602',
        lot: '47',
        qualifier: null,
        extraLots: [],
        consideration: null,
        detail: null,
        parties: [
          { side: 'direct', name: 'HAMILTON ANDREW' },
          { side: 'indirect', name: 'BONVINI MARCELLO' },
        ],
        links: [],
      },
    });
  });

  it('keys a book-only record as BK:<book>/<page> and splits the book type', () => {
    const result = validateClerkDocument(rows({ instrumentNumber: null, book: 'M5120', page: '88' }), args);

    expect(result).toMatchObject({
      ok: true,
      record: { instrumentNumber: 'BK:M5120/88', bookType: 'M', book: '5120' },
    });
  });

  it('rejects a document with no instrument number or book/page', () => {
    expect(validateClerkDocument(rows({ instrumentNumber: null, book: null, page: null }), args)).toEqual({
      ok: false,
      reason: 'no instrument number and no book/page',
    });
  });

  it('rejects an unparseable recorded date', () => {
    expect(validateClerkDocument(rows({ recorded: '13/45/2006' }), args)).toMatchObject({ ok: false });
    expect(validateClerkDocument(rows({ recorded: null }), args)).toMatchObject({ ok: false });
  });

  it('drops a block that is not a block, with a warning', () => {
    const result = validateClerkDocument(rows({ block: 'SEE ATTACHED SCHEDULE OF LOTS AND BLOCKS' }), args);

    expect(result).toMatchObject({ ok: true, record: { block: null, lot: null } });
    expect(result.ok && result.warnings).toEqual([
      expect.objectContaining({ field: 'block', reason: 'not a block/lot value' }),
    ]);
  });

  it('stores an unmapped description as OTHER and reports it', () => {
    expect(validateClerkDocument(rows({ docTypeRaw: 'NEW KIND OF DEED' }), args)).toMatchObject({
      ok: true,
      unmappedDocType: 'NEW KIND OF DEED',
      record: { docCategory: 'OTHER' },
    });
  });

  it('makes a deed from the sheriff a sheriff’s deed', () => {
    expect(validateClerkDocument(rows({ direct: ['ESSEX COUNTY SHERIFF'] }), args)).toMatchObject({
      record: { docCategory: 'SHERIFF_DEED' },
    });
  });
});
