import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { connect, directNeonUrl } from './neon-migrate.mjs';

let client;
try {
  // HTTP runtime verification is read-only and uses the same transaction-scoped
  // role and identity setup as the Node and Cloudflare account API.
  const pooled = process.env.DATABASE_URL?.trim();
  if (!pooled) throw new Error('Fill DATABASE_URL first.');
  const sql = neon(pooled, { fetchOptions: { signal: AbortSignal.timeout(15_000) } });
  const userId = `FirebaseTest_${randomUUID()}`, otherId = `FirebaseOther_${randomUUID()}`;
  const result = await sql.transaction([
    sql`select set_config('role', 'blocklens_app', true)`,
    sql`select set_config('blocklens.user_id', ${userId}, true)`,
    sql`select current_user as role, public.current_account_id()::text as user_id`,
    sql`select id from public.profiles`,
  ]);
  if (result[2][0]?.role !== 'blocklens_app' || result[2][0]?.user_id !== userId || result[3].length) throw new Error('HTTP identity isolation failed.');

  client = await connect(directNeonUrl());
  await client.query('begin');
  try {
    await client.query('set local role blocklens_app');
    await client.query("select set_config('blocklens.user_id', $1, true)", [userId]);
    await client.query('insert into public.profiles (id, display_name) values ($1,$2)', [userId, 'Migration verification']);
    await client.query('insert into public.watchlist_items(user_id,coin_id) values ($1,$2)', [userId, 'bitcoin']);
    const mine = await client.query('select coin_id from public.watchlist_items');
    if (mine.rows.length !== 1 || mine.rows[0].coin_id !== 'bitcoin') throw new Error('Account write/read failed.');
    await client.query("select set_config('blocklens.user_id', $1, true)", [otherId]);
    const hidden = await client.query('select coin_id from public.watchlist_items');
    if (hidden.rowCount) throw new Error('Cross-account isolation failed.');
    await client.query('set local role none');
    const quota = await client.query('select public.consume_ai_analysis_quota($1) as allowed', ['b'.repeat(64)]);
    if (typeof quota.rows[0]?.allowed !== 'boolean') throw new Error('Atomic quota failed.');
  } finally {
    // Verification records and quota increments are never committed.
    await client.query('rollback');
  }
  console.log('Verified: Neon HTTP transactions, restricted role, profile/watchlist writes, cross-account isolation, and atomic quota. Test writes rolled back.');
} catch {
  console.error('Neon verification failed. Connection credentials and database error details were not logged.');
  process.exitCode = 1;
} finally { await client?.end(); }
