import { describe, expect, it } from 'vite-plus/test';
import { parseCountyPropertyIds } from './parseCountyPropertyIds';
import { readFixture } from '../__fixtures__/stubClientAdapter';

describe('parseCountyPropertyIds', () => {
  it("reads each listing's property ID from the county listings page", async () => {
    await expect(parseCountyPropertyIds(readFixture('countyListingsPassaic.html'))).resolves.toEqual([
      2195502430, 2195503103, 2195503233,
    ]);
  });

  it('skips a row without a details link', async () => {
    const html = `
      <table><tr><td><h1>County, NJ - Foreclosure Sales Listing</h1></td></tr></table>
      <table>
        <tr><th></th><th>Sheriff #</th></tr>
        <tr><td></td><td>No sales found</td></tr>
        <tr><td><a href="/Sales/SaleDetails?PropertyId=101">View Details</a></td><td>F-1</td></tr>
      </table>`;

    await expect(parseCountyPropertyIds(html)).resolves.toEqual([101]);
  });

  it('rejects a page with no listings table', async () => {
    await expect(parseCountyPropertyIds('<html><body>Maintenance</body></html>')).rejects.toThrow(
      'County listings layout not recognised: no listings table',
    );
  });
});
