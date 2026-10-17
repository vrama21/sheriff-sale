import { HeadObjectCommandInput } from '@aws-sdk/client-s3';
import { s3 } from './s3Client';

interface HeadConfig {
  bucketName: string;
  key: string;
}

/**
 * Checks whether an object exists in a bucket, without downloading its body.
 * Resolves false only when S3 reports the object missing; any other error is rethrown.
 */
export const s3ObjectExists = async ({ bucketName, key }: HeadConfig): Promise<boolean> => {
  const params: HeadObjectCommandInput = {
    Bucket: bucketName,
    Key: key,
  };

  try {
    await s3.headObject(params);

    return true;
  } catch (error) {
    const { name, $metadata } = error as { name?: string; $metadata?: { httpStatusCode?: number } };

    if (name === 'NotFound' || $metadata?.httpStatusCode === 404) {
      return false;
    }

    throw error;
  }
};
