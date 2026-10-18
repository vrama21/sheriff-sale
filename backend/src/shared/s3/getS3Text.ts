import { s3 } from './s3Client';

interface GetTextConfig {
  bucketName: string;
  key: string;
}

/**
 * Reads an object as UTF-8 text, or resolves undefined when the key doesn't exist.
 * Without s3:ListBucket a missing key is AccessDenied, not NoSuchKey, so that rejects like any other error.
 */
export const getS3Text = async ({ bucketName, key }: GetTextConfig): Promise<string | undefined> => {
  try {
    const response = await s3.getObject({ Bucket: bucketName, Key: key });

    return (await response.Body?.transformToString('utf-8')) ?? '';
  } catch (error) {
    if (error instanceof Error && error.name === 'NoSuchKey') {
      return undefined;
    }

    throw error;
  }
};
