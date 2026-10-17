import { describe, expect, it } from 'vite-plus/test';
import { cleanPropertyKey } from './cleanPropertyKey';

describe('cleanPropertyKey', () => {
  // Every label in the __fixtures__ detail pages, current and legacy layouts, as the parsers pass it in.
  it.each([
    ['Sheriff #', 'sheriffId'],
    ['Court Case #', 'courtCase'],
    ['Sales Date', 'saleDate'],
    ['Plaintiff', 'plaintiff'],
    ['Defendant', 'defendant'],
    ['Address', 'address'],
    ['Description', 'description'],
    ['Attorney', 'attorney'],
    ['Approximate Judgment', 'judgment'],
    ['Approx. Judgment*', 'judgment'],
    ['Parcel #', 'parcel'],
    ['Property Note', 'propertyNote'],
    ['Approx. Upset*', 'upsetAmount'],
    ['Upset Amount', 'upsetAmount'],
    ['Priors', 'priors'],
    ['Deed', 'deed'],
    ['Deed Address', 'deedAddress'],
  ])('maps the fixture label %j to %j', (label, key) => {
    expect(cleanPropertyKey(label)).toBe(key);
  });

  it.each([
    ['Sheriff #:', 'sheriffId'],
    ['Attorney Phone', 'attorneyPhone'],
    ['  Deed Address  ', 'deedAddress'],
    ['PROPERTY NOTE', 'propertyNote'],
    ['Deed Book/Page', 'deedBookPage'],
    ['', ''],
  ])('maps %j to %j', (label, key) => {
    expect(cleanPropertyKey(label)).toBe(key);
  });

  // The sheriff and upset rules rewrite the key to camelCase before the final conversion, which must keep it.
  it.each(['sheriffId', 'upsetAmount', 'saleDate', 'attorneyPhone', 'deedAddress'])(
    'keeps the camelCased key %j unchanged',
    (key) => {
      expect(cleanPropertyKey(key)).toBe(key);
    },
  );
});
