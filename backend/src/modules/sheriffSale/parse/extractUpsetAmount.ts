// How the notices name the upset price. "of the bid amount" is left out: it's Monmouth's deposit terms ("20% of the bid
// amount at the time of sale ... Cash (with a limit of $1,000.00)"), which name no upset price.
const UPSET_PHRASE_RE = /upset|good faith estimate|estimated bid|(?<!of the )bid amount/i;

// How far after the phrase its figure can start.
const SEARCH_LENGTH = 200;

// `$` and digits, or digits with comma grouping, so a year, a block or a lot number isn't one; optionally with cents.
// It mustn't run on into more digits: a typo like `$167,5000.00` is no figure, rather than the wrong one.
const MONEY_FIGURE_RE = /(?:\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)|\b\d{1,3}(?:,\d{3})+)(?:\.\d{2})?(?![\d.,]?\d)/;

/**
 * The upset amount a notice states in free text: the first money-shaped figure starting within 200 characters after
 * its first upset phrase (`APPROXIMATE GOOD FAITH ESTIMATE OF UPSET PRICE: $143,198.00`). Returns the figure's text
 * for listingSchema to coerce, or undefined when the text has no upset phrase or no figure follows it.
 */
export const extractUpsetAmount = (text: string): string | undefined => {
  const phrase = UPSET_PHRASE_RE.exec(text);

  if (!phrase) {
    return undefined;
  }

  const figure = MONEY_FIGURE_RE.exec(text.slice(phrase.index + phrase[0].length));

  return figure && figure.index < SEARCH_LENGTH ? figure[0] : undefined;
};
