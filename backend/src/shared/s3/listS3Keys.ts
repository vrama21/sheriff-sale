import { s3 } from './s3Client';

/** Every key under `prefix`, paging through ListObjectsV2. Needs s3:ListBucket on the bucket. */
export const listS3Keys = async (bucketName: string, prefix: string): Promise<Set<string>> => {
  const keys = new Set<string>();
  let continuationToken: string | undefined;

  do {
    const response = await s3.listObjectsV2({
      Bucket: bucketName,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });

    response.Contents?.forEach(({ Key }) => {
      if (Key) {
        keys.add(Key);
      }
    });
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
};
