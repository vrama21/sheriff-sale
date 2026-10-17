import { DateTime } from 'luxon';
import { saveS3 } from '../s3';

// Managed in infra/storage.tf.
const bucketName = 'nj-sheriff-sale';

export type SaveHtmlToS3Args = {
  html: string;
  keyPrefix: string;
  keySuffix: string;
};

/** The UTC date, `YYYY-MM-DD`, that today's pages are archived under; a scraped page's snapshot date. */
export const todaysArchiveDate = (): string => DateTime.utc().toISODate();

export const saveHtmlToS3 = async ({ html, keyPrefix, keySuffix }: SaveHtmlToS3Args) => {
  const s3FileName = `${keyPrefix}/${todaysArchiveDate()}/${keySuffix}`;

  // No existence check: without s3:ListBucket a missing key returns 403, not 404. Overwriting today's
  // key on a retry is harmless.
  console.log(`Saving ${s3FileName} to bucket ${bucketName} ...`);
  await saveS3({
    bucketName,
    data: html,
    key: s3FileName,
  });
};
