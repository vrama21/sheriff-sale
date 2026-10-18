import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { getS3, saveS3 } from '../../../shared/s3';
import { saveHtmlToS3 } from './saveHtmlToS3';

vi.mock('../../../shared/s3', () => ({ getS3: vi.fn(), saveS3: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('saveHtmlToS3', () => {
  it('writes once to the dated key without reading from the bucket first', async () => {
    await saveHtmlToS3({ html: '<table></table>', keyPrefix: 'listing-html-files', keySuffix: 'property-id-42.html' });

    expect(saveS3).toHaveBeenCalledTimes(1);
    expect(saveS3).toHaveBeenCalledWith({
      bucketName: 'nj-sheriff-sale',
      data: '<table></table>',
      key: expect.stringMatching(/^listing-html-files\/\d{4}-\d{2}-\d{2}\/property-id-42\.html$/),
    });
    expect(getS3).not.toHaveBeenCalled();
  });
});
