import { GetObjectCommandInput } from '@aws-sdk/client-s3';
import { s3 } from './s3Client';

interface GetConfig {
  bucketName: string;
  key: string;
}

/**
 * Gets object from bucket
 * @param bucketName - name of bucket
 * @param key - name of key
 */
export const getS3 = async ({ bucketName, key }: GetConfig) => {
  const params: GetObjectCommandInput = {
    Bucket: bucketName,
    Key: key,
  };

  return s3.getObject(params);
};
