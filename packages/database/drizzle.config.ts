import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env') });

const { DATABASE_URL } = process.env;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export default defineConfig({
  dbCredentials: {
    url: DATABASE_URL,
  },
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/schema/index.ts',
});
