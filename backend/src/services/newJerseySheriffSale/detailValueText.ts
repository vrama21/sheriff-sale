import { HTMLElement, Node } from 'node-html-parser';

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

/** A details-page value's text, trimmed per line; lines are kept apart only when `keepLineBreaks` is set. */
export const cleanValue = (valueElement: HTMLElement, keepLineBreaks: boolean): string => {
  const lines = textWithLineBreaks(valueElement)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line);

  return lines.join(keepLineBreaks ? '\n' : ' ');
};
