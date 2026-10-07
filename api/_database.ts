import { neon } from '@neondatabase/serverless';
import type { ServerEnvironment } from './_env.ts';

export const databaseClient = (environment: ServerEnvironment) => {
  const url = environment.DATABASE_URL?.trim();
  if (!url) throw new Error('Database is not configured.');
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname.endsWith('.neon.tech')) {
    throw new Error('A Neon database connection is required.');
  }
  return neon(url, { fetchOptions: { signal: AbortSignal.timeout(10_000) } });
};
