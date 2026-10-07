import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cert } from 'firebase-admin/app';
import { applicationTables, quotaTables, connect } from './neon-migrate.mjs';

const guard = 'blocklens_migration_write_pause';
const guardComment = 'BlockLens Supabase cutover write guard v1';
const inactiveComment = `${guardComment} (inactive)`;
export const sourceTables = ['auth.users', 'auth.identities', ...applicationTables.map(t => `public.${t}`), ...quotaTables.map(t => `public.${t}`)];
const statePath = new URL('../.migration-secrets/firebase-signup-pause.json', import.meta.url);

export const sourcePauseStatus = async client => {
  const result = await client.query(`select n.nspname || '.' || c.relname as table_name,
    p.proname = $1 and pn.nspname = 'public' and obj_description(p.oid, 'pg_proc') = any($2::text[]) as owned,
    obj_description(p.oid, 'pg_proc') = $4 as active,
    t.tgenabled = 'O' as enabled
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
    where t.tgname = $1 and n.nspname || '.' || c.relname = any($3::text[])`, [guard, [guardComment, inactiveComment], sourceTables, guardComment]);
  return { paused: result.rows.length === sourceTables.length && result.rows.every(r => r.owned && r.active && r.enabled), guards: result.rows };
};

export const setSourcePause = async (client, pause) => {
  await client.query('begin');
  try {
    await client.query("set local lock_timeout = '10s'");
    await client.query("set local statement_timeout = '30s'");
    const functionInfo = await client.query(`select obj_description(p.oid, 'pg_proc') as comment
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`, [guard]);
    if (functionInfo.rows.some(r => ![guardComment, inactiveComment].includes(r.comment))) throw new Error('A migration guard name is already used by another function.');
    const before = await sourcePauseStatus(client);
    if (before.guards.some(r => !r.owned)) throw new Error('A migration trigger name is already used by another function.');
    if (pause) {
      {
        await client.query(`create or replace function public.${guard}() returns trigger language plpgsql
          set search_path = pg_catalog as $$ begin
          raise exception using errcode = '55000', message = 'Account data has moved. Writes to the old database are paused during cutover.';
          end $$`);
        await client.query(`comment on function public.${guard}() is '${guardComment}'`);
      }
      for (const table of sourceTables) {
        if (!before.guards.some(r => r.table_name === table)) await client.query(`create trigger ${guard}
          before insert or update or delete or truncate on ${table} for each statement execute function public.${guard}()`);
        if (before.guards.some(r => r.table_name === table && !r.enabled)) throw new Error('An existing source guard is disabled; inspect it before migration.');
      }
      if (!(await sourcePauseStatus(client)).paused) throw new Error('Source write pause verification failed.');
    } else {
      // Supabase manages ownership of auth tables. Restore writes by changing
      // our own function to a no-op; dropping managed-table triggers needs
      // ownership that a normal Supabase database connection does not have.
      if (functionInfo.rowCount) {
        await client.query(`create or replace function public.${guard}() returns trigger language plpgsql
          set search_path = pg_catalog as $$ begin return null; end $$`);
        await client.query(`comment on function public.${guard}() is '${inactiveComment}'`);
      }
    }
    await client.query('commit');
    return { status: pause ? 'Supabase writes and account changes paused' : 'Supabase writes restored', tables: sourceTables.length };
  } catch (error) { await client.query('rollback'); throw error; }
};

const firebaseRequest = async (projectId, credential, method = 'GET', disabledUserSignup) => {
  const { access_token } = await credential.getAccessToken();
  const url = new URL(`https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`);
  if (method === 'PATCH') url.searchParams.set('updateMask', 'client.permissions.disabledUserSignup');
  const response = await fetch(url, {
    method, headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    ...(method === 'PATCH' ? { body: JSON.stringify({ name: `projects/${projectId}/config`, client: { permissions: { disabledUserSignup } } }) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('Firebase signup configuration request failed.');
  return response.json();
};

const setFirebasePause = async pause => {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const serviceAccount = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  if (!projectId || serviceAccount.project_id !== projectId) throw new Error('Firebase credential project mismatch.');
  const credential = cert(serviceAccount);
  const current = await firebaseRequest(projectId, credential);
  let state;
  if (existsSync(statePath)) {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (state.projectId !== projectId) throw new Error('Saved Firebase pause belongs to another project.');
  }
  if (pause && !state) {
    state = { projectId, originalSignupDisabled: current.client?.permissions?.disabledUserSignup ?? false };
    mkdirSync(new URL('../.migration-secrets/', import.meta.url), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2), { flag: 'wx' });
  }
  if (!state) throw new Error('No original Firebase signup setting saved; refusing to guess.');
  const expected = pause ? true : state.originalSignupDisabled;
  await firebaseRequest(projectId, credential, 'PATCH', expected);
  const verified = await firebaseRequest(projectId, credential);
  if ((verified.client?.permissions?.disabledUserSignup ?? false) !== expected) throw new Error('Firebase signup pause verification failed.');
  return { status: expected ? 'Firebase client signups paused' : 'Firebase client signups enabled' };
};

const run = async () => {
  let client;
  try {
    const resume = process.argv.includes('--resume');
    if (process.argv.includes('--firebase')) console.log(JSON.stringify(await setFirebasePause(!resume)));
    else if (process.argv.includes('--source')) {
      if (!process.env.SUPABASE_DATABASE_URL) throw new Error('Source connection is missing.');
      client = await connect(process.env.SUPABASE_DATABASE_URL);
      console.log(JSON.stringify(await setSourcePause(client, !resume)));
    } else throw new Error('Choose --firebase or --source, with --resume to restore writes.');
  } catch (error) {
    console.error('Migration pause failed; database changes were rolled back. Check service permissions and the saved pause state.');
    process.exitCode = 1;
  } finally { await client?.end(); }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
