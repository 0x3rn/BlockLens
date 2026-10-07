import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { pathToFileURL } from 'node:url';

export const applicationTables = ['profiles', 'portfolios', 'portfolio_positions', 'watchlist_items', 'price_alerts', 'ai_analysis_history', 'position_history', 'paper_futures_accounts'];
export const quotaTables = ['ai_analysis_rate_limits', 'ai_analysis_global_limit', 'history_write_limits'];

export const directNeonUrl = () => {
  const value = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (!value) throw new Error('Fill DATABASE_URL_UNPOOLED in .env.local first.');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech') || url.hostname.includes('-pooler.')) {
    throw new Error('DATABASE_URL_UNPOOLED must be a direct Neon Postgres URL.');
  }
  if (!['require', 'verify-full'].includes(url.searchParams.get('sslmode'))) throw new Error('The Neon URL must require TLS.');
  return value;
};

export const connect = async (connectionString) => {
  const secureUrl = new URL(connectionString);
  if (secureUrl.searchParams.get('sslmode') === 'require') secureUrl.searchParams.set('sslmode', 'verify-full');
  const client = new pg.Client({ connectionString: secureUrl.toString(), connectionTimeoutMillis: 10_000 });
  client.on('error', () => {});
  await client.connect();
  await client.query("set time zone 'UTC'");
  return client;
};

export const applySchema = async (client) => {
  const migrationDirectory = new URL('../neon/migrations/', import.meta.url);
  await client.query('begin');
  try {
    await client.query('create table if not exists public.blocklens_migrations (version text primary key, applied_at timestamptz not null default now())');
    await client.query('lock table public.blocklens_migrations in exclusive mode');
    const existing = await client.query('select version from public.blocklens_migrations');
    const applied = new Set(existing.rows.map((row) => row.version));
    for (const filename of readdirSync(migrationDirectory).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort()) {
      const version = filename.slice(0, -4);
      if (applied.has(version)) continue;
      if (version === '0001_blocklens') {
        const tables = await client.query('select tablename from pg_tables where schemaname = $1 and tablename = any($2::text[])', ['public', applicationTables]);
        if (tables.rowCount) throw new Error('Target already contains app tables without a migration record; inspect it before applying a schema.');
      }
      await client.query(readFileSync(new URL(filename, migrationDirectory), 'utf8'));
      await client.query('insert into public.blocklens_migrations (version) values ($1)', [version]);
      console.log(`Applied ${version}.`);
    }
    await client.query('commit');
  } catch (error) { await client.query('rollback'); throw error; }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let client;
  try {
    client = await connect(directNeonUrl());
    if (process.argv.includes('--apply')) await applySchema(client);
    const result = await client.query('select tablename from pg_tables where schemaname = $1 and tablename = any($2::text[]) order by tablename', ['public', [...applicationTables, ...quotaTables]]);
    console.log(`${process.argv.includes('--apply') ? 'Schema applied.' : 'Read-only schema check.'} ${result.rowCount} app/quota tables found.`);
    for (const { tablename } of result.rows) {
      const count = await client.query(`select count(*)::text as count from public."${tablename}"`);
      console.log(`${tablename}: ${count.rows[0].count} rows`);
    }
  } catch (error) {
    // Never print connection errors that may include a credential-bearing URL.
    console.error(error instanceof Error && /^(Fill |DATABASE_URL|The Neon URL|Target already)/.test(error.message) ? error.message : 'Neon migration failed. Check connection/access and schema; credentials were not logged.');
    process.exitCode = 1;
  } finally { await client?.end(); }
}
