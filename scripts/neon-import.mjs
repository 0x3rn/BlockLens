import { createHash } from 'node:crypto';
import { applicationTables, quotaTables, connect, directNeonUrl } from './neon-migrate.mjs';

// Import into an empty, migrated Neon database. Source is always read-only;
// all target writes roll back together if any copied row fails verification.
let source, target;
try {
  if (!process.argv.includes('--source-writes-paused')) throw new Error('Pause source app writes, then rerun with --source-writes-paused before final cutover.');
  const sourceUrl = process.env.SUPABASE_DATABASE_URL?.trim();
  if (!sourceUrl) throw new Error('Fill SUPABASE_DATABASE_URL in .env.local first.');
  const parsed = new URL(sourceUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['require', 'verify-full'].includes(parsed.searchParams.get('sslmode'))) throw new Error('Use a TLS-enabled Supabase Postgres connection.');
  source = await connect(sourceUrl);
  target = await connect(directNeonUrl());
  await source.query('begin isolation level repeatable read read only');
  await target.query('begin isolation level serializable');
  await target.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', ['blocklens-import']);
  for (const table of [...applicationTables, 'ai_analysis_rate_limits', 'history_write_limits']) {
    await target.query(`lock table public."${table}" in access exclusive mode`);
    const { rows } = await target.query(`select exists(select 1 from public."${table}") as populated`);
    if (rows[0].populated) throw new Error('Target contains existing data; refusing to merge or overwrite it.');
  }
  await target.query('lock table public.ai_analysis_global_limit in access exclusive mode');
  const budget = await target.query('select request_count from public.ai_analysis_global_limit');
  if (budget.rows.some((row) => row.request_count !== 0)) throw new Error('Target quota is already active; refusing to overwrite it.');
  for (const table of ['ai_analysis_history', 'position_history']) await target.query(`alter table public."${table}" disable trigger user`);
  const report = {};
  for (const table of [...applicationTables, ...quotaTables]) {
    // Raw JSON text keeps exact numeric values and UUIDs; no JS number conversion.
    await source.query(`declare transfer_cursor no scroll cursor for select to_jsonb(t)::text as row from public."${table}" t order by to_jsonb(t)::text`);
    const before = createHash('sha256'), after = createHash('sha256');
    let count = 0;
    while (true) {
      const batch = await source.query('fetch forward 500 from transfer_cursor');
      if (!batch.rowCount) break;
      for (const { row } of batch.rows) {
        const conflict = table === 'ai_analysis_global_limit'
          ? ' on conflict (singleton) do update set day_started_at = excluded.day_started_at, request_count = excluded.request_count'
          : '';
        const inserted = await target.query(`insert into public."${table}" select * from jsonb_populate_record(null::public."${table}", $1::jsonb)${conflict} returning to_jsonb("${table}")::text as row`, [row]);
        before.update(row + '\n'); after.update(inserted.rows[0].row + '\n'); count += 1;
      }
    }
    await source.query('close transfer_cursor');
    const checksum = before.digest('hex');
    if (checksum !== after.digest('hex')) throw new Error('Copied row checksum differs; target changes will roll back.');
    const targetCount = await target.query(`select count(*)::text as count from public."${table}"`);
    if (BigInt(targetCount.rows[0].count) !== BigInt(count)) throw new Error('Copied row count differs; target changes will roll back.');
    report[table] = { count, checksum };
  }
  for (const table of ['ai_analysis_history', 'position_history']) await target.query(`alter table public."${table}" enable trigger user`);
  await source.query('commit');
  await target.query('commit');
  console.log(JSON.stringify({ status: 'verified', tables: report }, null, 2));
} catch (error) {
  await target?.query('rollback').catch(() => {});
  await source?.query('rollback').catch(() => {});
  console.error(error instanceof Error && /^(Pause |Fill |Use |Target |Copied )/.test(error.message) ? error.message : 'Import failed; rollback was attempted. Check database connections, source migrations, and target state before retrying.');
  process.exitCode = 1;
} finally { await Promise.all([source?.end(), target?.end()]); }
