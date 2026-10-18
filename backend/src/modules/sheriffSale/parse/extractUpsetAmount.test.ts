import { describe, expect, it } from 'vite-plus/test';
import { extractUpsetAmount } from './extractUpsetAmount';

describe('extractUpsetAmount', () => {
  // Each from an archived page.
  it.each([
    ['APPROX. UPSET: $1,108,438.48', '$1,108,438.48'],
    ['APPROXIMATE GOOD FAITH ESTIMATE OF UPSET PRICE: $143,198.00', '$143,198.00'],
    ['UPSET RPIVE: $347,505.92', '$347,505.92'],
    [
      'UPSET AMOUNT: THE AMOUNT OF THE FINAL FORECLOSURE JUDGEMNET THAT MUCH BE SATISFIED BY THIS SALE IS 1,668,737.41, ' +
        'TOGETHER WITH COST OF THE SALE',
      '1,668,737.41',
    ],
    ['ESTIMATED UPSET BID AMOUNT: 201,700.00 PLUS ANY ADDITIONAL SUMS AS ORDERED BY THE COURT.', '201,700.00'],
    ["THE PLAINTIFF'S UPSET BID PRESENTLY APPROXIMATES $336,500.00 OCCUPANCY STATUS: UNKNOWN", '$336,500.00'],
    ['UPSET PRICE: APPROXIMATLEY $ 426,326.28 AND ANY ADDITIONAL SUMS', '$ 426,326.28'],
    ["PLAINTIFF'S GOOD FAITH ESTIMATE OF ITS UPSET PRICE IS : $ $572,377.24", '$572,377.24'],
    ['THE UPSET AMOUNT THROUGH AUGUST 17, 2026 OD $383,567.45 THE PROPERTY IS BELIEVED', '$383,567.45'],
    ['Good Faith Estimate of the Upset Bid amount as of 8/28/2026 is $50,101.73.', '$50,101.73'],
    ['OWNER OCCUPIED Estimated Upset Bud Amount: $413,000.00 plus any additional sums', '$413,000.00'],
    ['Estimated upset bid amount: $358,000 • 00—,plus any additional sums', '$358,000'],
    ['ESTIMATED BID: $99,000', '$99,000'],
    [
      'The approximate amount of the upset price is $210,000.00, more or less, which consists of the final judgment ' +
        'amount of $190,000.00, plus interest',
      '$210,000.00',
    ],
  ])('finds the upset figure in %j', (text, figure) => {
    expect(extractUpsetAmount(text)).toBe(figure);
  });

  it('skips plain numbers before the figure, such as a date or a block and lot', () => {
    expect(extractUpsetAmount('UPSET PRICE THROUGH 3/1/2026 FOR BLOCK 1901 LOT 64: $574,128.31')).toBe('$574,128.31');
  });

  it.each([
    ['a judgment-only sentence', 'The approximate amount of the judgment to be satisfied by the sale is $250,000.00.'],
    [
      "Monmouth's deposit terms",
      'DEPOSIT: 20% of the bid amount at the time of sale. Balance due in 30 days. Cash (with a limit of $1,000.00) or ' +
        "cashier's check only. The approximate judgment amount is the sum of $711,096.10.",
    ],
    ['blank text', ''],
    ['a typo that runs the figure on', 'UPSET ON THE DATE OF SALE (APPROXIMATE ): $167,5000.00 OCCUPANCY'],
    ['an upset phrase with no figure', 'The upset price will be announced at the sale.'],
  ])('finds nothing in %s', (_case, text) => {
    expect(extractUpsetAmount(text)).toBeUndefined();
  });

  it('takes only a figure that starts within 200 characters of the phrase', () => {
    expect(extractUpsetAmount(`UPSET PRICE: ${'x'.repeat(185)} $412,000.00`)).toBe('$412,000.00');
    expect(extractUpsetAmount(`UPSET PRICE: ${'x'.repeat(200)} $412,000.00`)).toBeUndefined();
  });

  it('reads only the first upset phrase', () => {
    expect(extractUpsetAmount(`Upset price to be announced. ${'x'.repeat(200)} Upset: $5,000.00`)).toBeUndefined();
  });
});
