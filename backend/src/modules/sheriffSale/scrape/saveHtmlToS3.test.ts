import { getS3, saveS3 } from '../../../shared/s3';
import { saveHtmlToS3 } from './saveHtmlToS3';

jest.mock('../../../shared/s3', () => ({ getS3: jest.fn(), saveS3: jest.fn() }));

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
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
