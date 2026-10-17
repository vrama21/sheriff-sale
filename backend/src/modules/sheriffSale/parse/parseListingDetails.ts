import { parse } from 'node-html-parser';
import { cleanPropertyKey } from './cleanPropertyKey';
import { cleanValue } from './detailValueText';

/** Each detail item's text keyed by its listing field name, unvalidated: listingSchema checks and coerces them. */
export const parseListingDetails = (propertyHtml: string): Record<string, string> => {
  const root = parse(propertyHtml);

  const detailItems = root.querySelectorAll('.sale-detail-item');

  if (detailItems.length === 0) {
    throw new Error('Listing details layout not recognised: no .sale-detail-item elements');
  }

  const property: Record<string, string> = {};

  detailItems.forEach((detailItem) => {
    const labelElement = detailItem.querySelector('.sale-detail-label');
    const valueElement = detailItem.querySelector('.sale-detail-value');

    if (!labelElement || !valueElement) {
      return;
    }

    const label = labelElement.text.replace(/\s+/g, ' ').trim().replace(/:$/, '');
    const key = cleanPropertyKey(label);

    if (!key) {
      return;
    }

    // The address keeps its street / "City NJ zip" line break for parseAddress to split on.
    property[key] = cleanValue(valueElement, key === 'address');
  });

  return property;
};
