import { parseCountyPropertyIds } from './parseCountyPropertyIds';
import { readFixture } from '../__fixtures__/stubClientAdapter';

describe('parseCountyPropertyIds', () => {
  it("reads each listing's property ID from the county listings page", async () => {
    await expect(parseCountyPropertyIds(readFixture('countyListingsPassaic.html'))).resolves.toEqual([
      2195502430, 2195503103, 2195503233,
    ]);
  });
});
