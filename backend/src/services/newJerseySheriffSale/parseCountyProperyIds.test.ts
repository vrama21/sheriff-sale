import { parseCountyProperyIds } from './parseCountyProperyIds';
import { readFixture } from './__fixtures__/stubClientAdapter';

describe('parseCountyProperyIds', () => {
  it("reads each listing's property ID from the county listings page", async () => {
    await expect(parseCountyProperyIds(readFixture('countyListingsPassaic.html'))).resolves.toEqual([
      2195502430, 2195503103, 2195503233,
    ]);
  });
});
