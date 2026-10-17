import { HTMLElement, Node, parse } from 'node-html-parser';
import { cleanPropertyKey } from './cleanPropertyKey';

/** The node's decoded text with whitespace runs collapsed, and each `<br>` as a newline. */
const textWithLineBreaks = (node: Node): string => {
  if (node instanceof HTMLElement) {
    if (node.rawTagName?.toLowerCase() === 'br') {
      return '\n';
    }

    return node.childNodes.map(textWithLineBreaks).join('');
  }

  return node.text.replace(/\s+/g, ' ');
};

const cleanValue = (valueElement: HTMLElement, keepLineBreaks: boolean): string => {
  const lines = textWithLineBreaks(valueElement)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line);

  return lines.join(keepLineBreaks ? '\n' : ' ');
};

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

    // The address keeps its street / "City NJ zip" line break for cleanAddress to split on.
    property[key] = cleanValue(valueElement, key === 'address');
  });

  return property;
};
