/**
 * lodash-style camelCase: splits on non-alphanumerics and on lower→upper boundaries, so a key that's already
 * camelCase ('sheriffId') comes back unchanged.
 */
const camelCase = (value: string): string =>
  (value.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [])
    .map((word, index) =>
      index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join('');

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

  // Middlesex and Cape May.
  if (cleanKey === 'Property Address') {
    return 'address';
  }

  // Cape May's lowest acceptable bid, which other counties publish as the upset price.
  if (cleanKey === 'Minimum Bid') {
    return 'upsetAmount';
  }

  return camelCase(cleanKey);
};
