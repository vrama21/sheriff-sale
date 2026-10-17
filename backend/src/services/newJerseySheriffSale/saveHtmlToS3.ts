import { DateTime } from 'luxon';
import { s3ObjectExists, saveS3 } from '../s3';

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

  console.log(`Checking if ${s3FileName} already exists ...`);
  if (await s3ObjectExists({ bucketName, key: s3FileName })) {
    console.log(`${s3FileName} already exists. Skipping save to s3.`);

    return;
  }

  console.log(`Saving ${s3FileName} to bucket ${bucketName} ...`);
  await saveS3({
    bucketName,
    data: html,
    key: s3FileName,
  });
};
