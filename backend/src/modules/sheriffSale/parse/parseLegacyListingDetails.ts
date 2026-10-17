import { parse } from 'node-html-parser';
import { cleanPropertyKey } from './cleanPropertyKey';
import { cleanValue } from './detailValueText';

/**
 * Parses the details table of pages archived before 2025-02-26, where each row is a `td.heading-bold` label cell
 * ("Sheriff #:") followed by its value cell. Like parseListingDetails, it returns each value's text keyed by its
 * listing field name, unvalidated: listingSchema checks and coerces them.
 */
export const parseLegacyListingDetails = (propertyHtml: string): Record<string, string> => {
  const root = parse(propertyHtml);

  const labelCells = root.querySelectorAll('td.heading-bold');

  if (labelCells.length === 0) {
    throw new Error('Legacy listing details layout not recognised: no td.heading-bold label cells');
  }

  const property: Record<string, string> = {};

  labelCells.forEach((labelCell) => {
    const valueCell = labelCell.nextElementSibling;

    if (!valueCell || valueCell.rawTagName?.toLowerCase() !== 'td') {
      return;
    }

    const label = labelCell.text.replace(/\s+/g, ' ').trim().replace(/:$/, '');
    const key = cleanPropertyKey(label);

    if (!key) {
      return;
    }

    property[key] = cleanValue(valueCell, key === 'address');
  });

  return property;
};
