import { beforeEach, describe, expect, it, vi, type Mock } from 'vite-plus/test';
import { listS3Keys } from './listS3Keys';
import { s3 } from './s3Client';

vi.mock('./s3Client', () => ({ s3: { listObjectsV2: vi.fn() } }));

const listObjectsV2 = s3.listObjectsV2 as unknown as Mock;

beforeEach(() => {
  vi.resetAllMocks();
});

describe('listS3Keys', () => {
  it('pages through every key under the prefix', async () => {
    listObjectsV2
      .mockResolvedValueOnce({
        Contents: [{ Key: 'a/1.html' }, { Key: 'a/2.html' }],
        IsTruncated: true,
        NextContinuationToken: 't1',
      })
      .mockResolvedValueOnce({ Contents: [{ Key: 'a/3.html' }], IsTruncated: false });

    await expect(listS3Keys('nj-sheriff-sale', 'a/')).resolves.toEqual(new Set(['a/1.html', 'a/2.html', 'a/3.html']));
    expect(listObjectsV2.mock.calls).toEqual([
      [{ Bucket: 'nj-sheriff-sale', Prefix: 'a/', ContinuationToken: undefined }],
      [{ Bucket: 'nj-sheriff-sale', Prefix: 'a/', ContinuationToken: 't1' }],
    ]);
  });

  it('resolves an empty set for a prefix with no keys', async () => {
    listObjectsV2.mockResolvedValueOnce({ KeyCount: 0, IsTruncated: false });

    await expect(listS3Keys('nj-sheriff-sale', 'a/')).resolves.toEqual(new Set());
  });

  it('rejects with the listing error', async () => {
    const error = Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' });
    listObjectsV2.mockRejectedValueOnce(error);

    await expect(listS3Keys('nj-sheriff-sale', 'a/')).rejects.toBe(error);
  });
});
