import { GetObjectCommandInput, S3 } from '@aws-sdk/client-s3';

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
  const s3 = new S3({ region: 'us-east-2' });

  const params: GetObjectCommandInput = {
    Bucket: bucketName,
    Key: key,
  };

  return s3.getObject(params);
};
