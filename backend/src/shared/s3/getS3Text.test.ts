import { getS3Text } from './getS3Text';
import { s3 } from './s3Client';

jest.mock('./s3Client', () => ({ s3: { getObject: jest.fn() } }));

const getObject = s3.getObject as unknown as jest.Mock;

const s3Error = (name: string) => Object.assign(new Error(name), { name });

beforeEach(() => {
  jest.resetAllMocks();
});

describe('getS3Text', () => {
  it('reads the object body as text', async () => {
    getObject.mockResolvedValue({ Body: { transformToString: jest.fn().mockResolvedValue('<html></html>') } });

    await expect(getS3Text({ bucketName: 'nj-sheriff-sale', key: 'a/b.html' })).resolves.toBe('<html></html>');
    expect(getObject).toHaveBeenCalledWith({ Bucket: 'nj-sheriff-sale', Key: 'a/b.html' });
  });

  it('resolves undefined for a missing key', async () => {
    getObject.mockRejectedValue(s3Error('NoSuchKey'));

    await expect(getS3Text({ bucketName: 'nj-sheriff-sale', key: 'missing.html' })).resolves.toBeUndefined();
  });

  it.each(['AccessDenied', 'NoSuchBucket', 'TimeoutError'])('rethrows %s', async (name) => {
    const error = s3Error(name);
    getObject.mockRejectedValue(error);

    await expect(getS3Text({ bucketName: 'nj-sheriff-sale', key: 'a/b.html' })).rejects.toBe(error);
  });
});
