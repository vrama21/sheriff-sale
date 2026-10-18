import { describe, expect, it } from 'vite-plus/test';
import { normalizeSheriffId, normalizeStatus } from './normalize';

describe('normalizeSheriffId', () => {
  it.each([
    ['F-24000056', 'F-24000056'],
    ['\r F-24000056   ', 'F-24000056'],
    ['20058093\n', '20058093'],
    ['F - 0102', 'F-0102'],
    ['F-0102\u00a0', 'F-0102'],
  ])('normalizes %j to %j', (sheriffId, expected) => {
    expect(normalizeSheriffId(sheriffId)).toBe(expected);
  });

  it.each([[''], ['\r                    '], [null], [undefined]])('treats %j as no sheriff number', (sheriffId) => {
    expect(normalizeSheriffId(sheriffId)).toBeNull();
  });
});

describe('normalizeStatus', () => {
  it.each([
    ['Scheduled', 'Scheduled'],
    ['\r ADJOURNED SHERIFF - New Sale Date:   ', 'ADJOURNED SHERIFF - New Sale Date:'],
    ['Adjourned\n  -  Court', 'Adjourned - Court'],
    ['Sold\u00a0to Plaintiff', 'Sold to Plaintiff'],
  ])('normalizes %j to %j', (status, expected) => {
    expect(normalizeStatus(status)).toBe(expected);
  });
});
