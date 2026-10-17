import { DateTime } from 'luxon';
import { saveS3 } from '../s3';

// Managed in infra/storage.tf.
const bucketName = 'nj-sheriff-sale';

export type SaveHtmlToS3Args = {
  html: string;
  keyPrefix: string;
  keySuffix: string;
};

export const saveHtmlToS3 = async ({ html, keyPrefix, keySuffix }: SaveHtmlToS3Args) => {
  const todaysDate = DateTime.utc().toISODate();

  const s3FileName = `${keyPrefix}/${todaysDate}/${keySuffix}`;

  // No existence check: without s3:ListBucket a missing key returns 403, not 404. Overwriting today's
  // key on a retry is harmless.
  console.log(`Saving ${s3FileName} to bucket ${bucketName} ...`);
  await saveS3({
    bucketName,
    data: html,
    key: s3FileName,
  });
};
