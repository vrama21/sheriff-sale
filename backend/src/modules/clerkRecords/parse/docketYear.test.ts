import { DateTime } from 'luxon';
import { describe, expect, it } from 'vite-plus/test';
import { docketYear } from './docketYear';

const now = DateTime.fromISO('2026-10-18T00:00:00Z');

describe('docketYear', () => {
  it.each([
    ['F-012441-25', 2025],
    ['F00258326', 2026],
    ['F 012110 25 CTL # 163224', 2025],
    ['F 000500 23 CTL# 163144', 2023],
    ['000290 25 CTL #163236', 2025],
    ['F 0004221-20 CTL# 163275', 2020],
    ['F-004124-25-B', 2025],
    ['F-22685-07-D', 2007],
    ['SWC-F-000573-25', 2025],
    ['F-002431-25 (CWPP INELIGIBLE)', 2025],
    ['F259925', 2025],
    ['F747223 F', 2023],
    ['00619326', 2026],
    ['SWCF01046725', 2025],
    ['2215-24', 2024],
    ['F-001971-18 PLURIES', 2018],
  ])('%s was filed in %i', (courtCase, year) => {
    expect(docketYear(courtCase, now)).toBe(year);
  });

  it('returns null for text that is not a docket', () => {
    expect(docketYear(null, now)).toBeNull();
    expect(docketYear('', now)).toBeNull();
    expect(docketYear('UNKNOWN', now)).toBeNull();
  });

  it('rejects a year after next year', () => {
    expect(docketYear('F-000001-28', now)).toBeNull();
  });
});
