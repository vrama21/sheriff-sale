import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Reads the environment only. Local entry points (migrate.ts, drizzle.config.ts, the backend's local scripts) load the
// repo-root .env before importing this module.
const { DATABASE_URL, DATABASE_POOL_MAX } = process.env;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// One connection unless set: the scraper Lambda never sets it. The archive replay sets it to run its syncs in parallel.
if (DATABASE_POOL_MAX !== undefined && !/^[1-9]\d*$/.test(DATABASE_POOL_MAX)) {
  throw new Error(`DATABASE_POOL_MAX must be a positive integer, got ${JSON.stringify(DATABASE_POOL_MAX)}`);
}

export const sql = postgres(DATABASE_URL, { max: DATABASE_POOL_MAX === undefined ? 1 : Number(DATABASE_POOL_MAX) });
export const db = drizzle({ client: sql, schema });
