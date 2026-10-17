export * from './client';
export * from './schema';
// Query helpers for consumers, so they share this package's drizzle-orm instead of depending on their own.
// drizzle's `sql` is renamed: `sql` is already the postgres.js client exported from ./client.
export { and, eq, sql as drizzleSql } from 'drizzle-orm';
