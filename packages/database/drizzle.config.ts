import 'dotenv/config';
import type { Config } from 'drizzle-kit';

const { DB_HOST, DB_NAME, DB_USER, DB_PASSWORD } = process.env;

if (!DB_HOST) throw new Error('DB_HOST not set');
if (!DB_NAME) throw new Error('DB_NAME not set');
if (!DB_USER) throw new Error('DB_USER not set');
if (!DB_PASSWORD) throw new Error('DB_PASSWORD not set');

export default {
  schema: './src/schema/index.ts',
  out: './drizzle',
  driver: 'pg',
  dbCredentials: {
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  },
} satisfies Config;
