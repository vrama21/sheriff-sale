import { DateTime } from 'luxon';
import { getS3, saveS3 } from '../s3';

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
  try {
    await getS3({
      bucketName,
      key: s3FileName,
    });
    console.log(`${s3FileName} already exists. Skipping save to s3.`);

    return;
  } catch (error) {
    console.log(`Saving ${s3FileName} to bucket ${bucketName} ...`);

    await saveS3({
      bucketName,
      data: html,
      key: s3FileName,
    });
  }
};
