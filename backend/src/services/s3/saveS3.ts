import { PutObjectCommandInput } from '@aws-sdk/client-s3';
import { s3 } from './s3Client';

interface SaveConfig {
  bucketName: string;
  data: string;
  key: string;
  /**
   * @default false
   */
  sse?: boolean;
}

/**
 * Saves data into S3
 */
export const saveS3 = ({ bucketName, data, key, sse = false }: SaveConfig) => {
  const params: PutObjectCommandInput = {
    Body: data,
    Bucket: bucketName,
    Key: key,
    ServerSideEncryption: sse ? 'AES256' : undefined,
  };

  return s3.putObject(params);
};
