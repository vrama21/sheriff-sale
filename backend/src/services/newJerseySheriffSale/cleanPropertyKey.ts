import { camelCase } from 'lodash';

const acceptedKeys = [
  'address',
  'attorney',
  'attorneyPhone',
  'courtCase',
  'deed',
  'deedAddress',
  'defendant',
  'description',
  'judgment',
  'parcel',
  'plaintiff',
  'priors',
  'saleDate',
  'sheriffId',
  'upsetAmount',
] as const;

export type PropertyKey = (typeof acceptedKeys)[number];

/** Maps a details-page label to its listing field, or undefined when the label isn't a listing field. */
export const cleanPropertyKey = (key: string): PropertyKey | undefined => {
  let cleanKey = key.replace(/#?:?/g, '').trim();

  if (cleanKey.toLowerCase().match(/sheriff/)) {
    cleanKey = 'sheriffId';
  }

  if (cleanKey.toLowerCase().match(/judgment/)) {
    cleanKey = 'judgment';
  }

  if (cleanKey.toLowerCase().match(/upset/)) {
    cleanKey = 'upsetAmount';
  }

  if (cleanKey === 'Sales Date') {
    return 'saleDate';
  }

  cleanKey = camelCase(cleanKey);

  if (!acceptedKeys.includes(cleanKey as PropertyKey)) {
    return undefined;
  }

  return cleanKey as PropertyKey;
};
