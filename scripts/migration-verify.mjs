import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cert, initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { applicationTables, quotaTables, connect, directNeonUrl } from './neon-migrate.mjs';

// Read-only database/API checks. Admin-minted sign-in tokens exercise existing
// imported UIDs without knowing or resetting anyone's password. Tokens and
// account details stay in memory; Firebase records these verification sign-ins.
let source, target, app;
let phase = 'configuration';
try {
  const credentials = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId || credentials.project_id !== projectId) throw new Error('Credential project mismatch.');
  app = initializeApp({ credential: cert(credentials), projectId }, 'blocklens-migration-verification');
  const auth = getAuth(app);
  source = await connect(process.env.SUPABASE_DATABASE_URL);
  target = await connect(directNeonUrl());
  await source.query('begin isolation level repeatable read read only');
  await target.query('begin isolation level repeatable read read only');
  const digest = async (client, table) => {
    const rows = await client.query(`select to_jsonb(t)::text as row from public.${table} t order by to_jsonb(t)::text`);
    const hash = createHash('sha256');
    rows.rows.forEach(({ row }) => hash.update(row + '\n'));
    return { count: rows.rowCount, checksum: hash.digest('hex') };
  };
  for (const table of [...applicationTables, ...quotaTables]) {
    const before = await digest(source, table), after = await digest(target, table);
    if (before.count !== after.count || before.checksum !== after.checksum) throw new Error('Database verification mismatch.');
  }
  console.log('Verified: all 11 source/target table counts and checksums match.');
  const { rows: users } = await source.query("select id::text as id from auth.users u where to_jsonb(u)->>'deleted_at' is null order by id");
  const profiles = await target.query('select id from public.profiles');
  const ids = new Set(users.map(u => u.id));
  if (profiles.rows.some(p => !ids.has(p.id))) throw new Error('A migrated profile has no imported user.');
  for (let i = 0; i < users.length; i++) {
    phase = 'Firebase imported user lookup';
    const uid = users[i].id;
    const imported = await auth.getUser(uid);
    if (imported.uid !== uid || !imported.customClaims?.blocklens_supabase_import) throw new Error('Imported UID verification failed.');
    phase = 'Firebase custom-token creation';
    const customToken = await auth.createCustomToken(uid);
    phase = 'Firebase verification sign-in';
    const signedIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.VITE_FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }), signal: AbortSignal.timeout(20_000),
    });
    const identity = await signedIn.json();
    if (!signedIn.ok || !identity.idToken) {
      const error = new Error('Imported Firebase sign-in verification failed.');
      const code = identity.error?.message?.split(' : ')[0];
      if (typeof code === 'string' && /^[A-Z_]+$/.test(code)) error.code = code;
      throw error;
    }
    const verifiedToken = await auth.verifyIdToken(identity.idToken);
    if (verifiedToken.uid !== uid) throw new Error('Verification sign-in returned a different UID.');
    for (const table of applicationTables) {
      phase = `Authenticated API read for ${table}`;
      const condition = table === 'profiles' ? 'id::text = $1' : table === 'portfolio_positions'
        ? 'portfolio_id in (select id from public.portfolios where user_id::text = $1)' : 'user_id::text = $1';
      const expected = await source.query(`select id::text as id from public.${table} where ${condition} order by id`, [uid]);
      if (expected.rowCount > 500) throw new Error('API verification needs pagination for this account.');
      const response = await fetch('http://127.0.0.1:5173/api/account', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.idToken}` },
        body: JSON.stringify({ table, operation: 'select', filters: [], columns: 'id' }), signal: AbortSignal.timeout(20_000),
      });
      const actual = await response.json();
      if (!response.ok || actual.error || !Array.isArray(actual.data)) {
        console.error(`Account API verification response: HTTP ${response.status}.`);
        const now = Math.floor(Date.now() / 1000);
        console.error(JSON.stringify({ issuedAtOffsetSeconds: verifiedToken.iat - now, authTimeOffsetSeconds: verifiedToken.auth_time - now,
          sessionValidationError: actual.error?.message === 'Your account session could not be verified.' }));
        throw new Error('Authenticated account API verification failed.');
      }
      const expectedIds = expected.rows.map(r => r.id).sort();
      const actualIds = actual.data.map(r => r.id).sort();
      if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
        console.error(`Ownership count check: expected ${expectedIds.length}, received ${actualIds.length}.`);
        throw new Error('Migrated account ownership verification failed.');
      }
    }
    console.log(`Verified: migrated account ${i + 1}/${users.length} can access exactly its own records across all 8 application tables.`);
  }
  await source.query('commit'); await target.query('commit');
  console.log('Verified: migrated Firebase identities, real ID-token validation, preserved ownership, and API isolation. No application records changed.');
} catch (error) {
  await source?.query('rollback').catch(() => {}); await target?.query('rollback').catch(() => {});
  const code = typeof error.code === 'string' && /^[a-z0-9_./-]{1,80}$/i.test(error.code) ? error.code : 'not reported';
  console.error(`Migration verification failed at ${phase} (code: ${code}). No credentials, tokens, or account details were logged.`);
  process.exitCode = 1;
} finally { await Promise.all([source?.end(), target?.end()]); if (app) await deleteApp(app); }
