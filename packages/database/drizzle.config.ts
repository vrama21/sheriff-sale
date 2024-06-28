import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: __dirname + '/../../.env' });

const { POSTGRES_HOST, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD } = process.env;

if (!POSTGRES_HOST) throw new Error('POSTGRES_HOST not set');
if (!POSTGRES_DB) throw new Error('POSTGRES_DB not set');
if (!POSTGRES_USER) throw new Error('POSTGRES_USER not set');
if (!POSTGRES_PASSWORD) throw new Error('POSTGRES_PASSWORD not set');

export default {
  schema: './src/schema/index.ts',
  out: './drizzle',
  driver: 'pg',
  dbCredentials: {
    host: POSTGRES_HOST,
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    database: POSTGRES_DB,
  },
} satisfies Config;
