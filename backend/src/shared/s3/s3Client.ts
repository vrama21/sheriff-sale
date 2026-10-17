import { S3 } from '@aws-sdk/client-s3';

// One client for the whole process so S3 calls share a connection pool.
export const s3 = new S3({ region: 'us-east-2' });
