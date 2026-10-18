import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { saveS3 } from '../../../shared/s3';
import { saveResultPageToS3 } from './saveResultPageToS3';

vi.mock('../../../shared/s3', () => ({ saveS3: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('saveResultPageToS3', () => {
  it('writes once under the clerk-records prefix, dated and named for the listing and step', async () => {
    await saveResultPageToS3({
      county: 'Cape May',
      listingId: 'listing-1',
      step: 'name',
      n: 2,
      html: '<table></table>',
    });

    expect(saveS3).toHaveBeenCalledTimes(1);
    expect(saveS3).toHaveBeenCalledWith({
      bucketName: 'nj-sheriff-sale',
      data: '<table></table>',
      key: expect.stringMatching(/^clerk-records\/cape-may\/\d{4}-\d{2}-\d{2}\/listing-1-name-2\.html$/),
    });
  });

  it('logs a failed save instead of throwing', async () => {
    vi.mocked(saveS3).mockRejectedValue(new Error('AccessDenied'));

    await expect(
      saveResultPageToS3({ county: 'Essex', listingId: 'listing-1', step: 'parcel', n: 1, html: '' }),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to archive'), expect.any(Error));
  });
});
