import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, deleteUser, updateProfile } from 'firebase/auth';
import { neon } from '@neondatabase/serverless';

// Runs against the local dev API. Credentials and temporary tokens stay in
// memory. Only records belonging to the newly created test UID are removed.
const config = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};
let app;
let auth;
let testUser;
let sql;
let phase = 'configuration';
const checks = [];
const request = async (body, token) => {
  const response = await fetch('http://127.0.0.1:5173/api/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json();
  if (!response.ok && response.status !== 401 && response.status !== 403) {
    console.error(`Account API returned HTTP ${response.status}: ${result.error?.message ?? 'Request failed.'}`);
  }
  return { status: response.status, ...result };
};
const query = (operation, extra = {}) => ({ table: 'watchlist_items', operation, filters: [], ...extra });
try {
  assert.ok(Object.values(config).every(value => value?.trim()));
  assert.equal(config.projectId, process.env.FIREBASE_PROJECT_ID);
  assert.ok(process.env.DATABASE_URL?.trim());
  sql = neon(process.env.DATABASE_URL, { fetchOptions: { signal: AbortSignal.timeout(20_000) } });
  phase = 'local API readiness';
  assert.equal((await request(query('select'))).status, 401);
  checks.push('unauthenticated requests rejected');
  app = initializeApp(config, `blocklens-verification-${randomUUID()}`);
  auth = initializeAuth(app, { persistence: inMemoryPersistence });
  const email = `blocklens-verification-${randomUUID()}@example.com`;
  const password = `Bl!9${randomBytes(32).toString('base64url')}`;
  phase = 'Firebase sign-up';
  testUser = (await createUserWithEmailAndPassword(auth, email, password)).user;
  await updateProfile(testUser, { displayName: 'Temporary verification account' });
  const uid = testUser.uid;
  let token = await testUser.getIdToken(true);
  checks.push('Firebase email/password sign-up');
  phase = 'authenticated Neon write';
  const saved = await request(query('upsert', {
    values: { user_id: uid, coin_id: 'bitcoin' }, onConflict: 'user_id,coin_id',
  }), token);
  assert.equal(saved.status, 200);
  assert.equal(saved.error, null);
  assert.equal(saved.data[0].user_id, uid);
  checks.push('real Firebase signature verification and Neon write');
  phase = 'account isolation';
  const foreignUid = `foreign-${randomUUID()}`;
  const hidden = await request(query('select', { filters: [{ column: 'user_id', operator: 'eq', value: foreignUid }] }), token);
  assert.equal(hidden.status, 200);
  assert.deepEqual(hidden.data, []);
  const forged = await request(query('insert', { values: { user_id: foreignUid, coin_id: 'bitcoin' } }), token);
  assert.equal(forged.status, 403);
  checks.push('foreign account reads and writes denied');
  phase = 'Firebase sign-out and sign-in';
  await signOut(auth);
  assert.equal(auth.currentUser, null);
  testUser = (await signInWithEmailAndPassword(auth, email, password)).user;
  assert.equal(testUser.uid, uid);
  token = await testUser.getIdToken();
  const restored = await request(query('select'), token);
  assert.equal(restored.status, 200);
  assert.equal(restored.data.length, 1);
  assert.equal(restored.data[0].coin_id, 'bitcoin');
  checks.push('sign-out, sign-in, and persisted account reload');
} catch (error) {
  const code = typeof error?.code === 'string' && /^auth\/[a-z0-9-]+$/.test(error.code) ? ` (${error.code})` : '';
  console.error(`Firebase verification failed during ${phase}${code}. Credentials and tokens were not logged.`);
  process.exitCode = 1;
} finally {
  let cleaned = true;
  if (testUser) {
    try {
      await sql`delete from public.profiles where id = ${testUser.uid}`;
      const remaining = await sql`select id from public.profiles where id = ${testUser.uid}`;
      assert.equal(remaining.length, 0);
    } catch {
      cleaned = false;
      console.error('Temporary Neon account cleanup failed.');
    }
    try { await deleteUser(testUser); }
    catch {
      cleaned = false;
      console.error('Temporary Firebase account cleanup failed.');
    }
  }
  if (app) await deleteApp(app);
  if (!cleaned) process.exitCode = 1;
  if (!process.exitCode) console.log(`Verified: ${checks.join('; ')}. Temporary Firebase and Neon records removed.`);
}
