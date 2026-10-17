import { camelCase } from 'lodash';

/** Maps a details-page label to its listing field's name; listingSchema decides whether that field is known. */
export const cleanPropertyKey = (key: string): string => {
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

  return camelCase(cleanKey);
};
