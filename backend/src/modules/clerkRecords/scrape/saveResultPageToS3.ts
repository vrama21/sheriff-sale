import { DateTime } from 'luxon';
import { NJCounty } from '../../../shared/nj';
import { saveS3 } from '../../../shared/s3';

// Managed in infra/storage.tf; the scraper's role already allows nj-sheriff-sale/* (design D12).
export const ARCHIVE_BUCKET_NAME = 'nj-sheriff-sale';
export const ARCHIVE_KEY_PREFIX = 'clerk-records';

export type ResultPage = {
  county: NJCounty;
  listingId: string;
  step: string;
  /** 1-based, per listing and step. */
  n: number;
  html: string;
};

export const countySlug = (county: NJCounty): string => county.toLowerCase().replace(/\s+/g, '-');

/** `clerk-records/<county-slug>/<YYYY-MM-DD>/<listingId>-<step>-<n>.html`, dated in UTC. */
export const resultPageKey = ({ county, listingId, step, n }: Omit<ResultPage, 'html'>): string =>
  `${ARCHIVE_KEY_PREFIX}/${countySlug(county)}/${DateTime.utc().toISODate()}/${listingId}-${step}-${n}.html`;

/**
 * Archives a result page with a single PutObject before it's parsed (design D13). Best effort: a failure is logged and
 * never stops the lookup.
 */
export const saveResultPageToS3 = async (page: ResultPage): Promise<void> => {
  const key = resultPageKey(page);

  try {
    await saveS3({ bucketName: ARCHIVE_BUCKET_NAME, data: page.html, key });
  } catch (error) {
    console.error(`Failed to archive ${key} to bucket ${ARCHIVE_BUCKET_NAME}; parsing it anyway`, error);
  }
};
