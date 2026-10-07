import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { applicationDefault, cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { connect } from './neon-migrate.mjs';

export class ImportCheckError extends Error {}
const marker = 'blocklens_supabase_import';
const fail = message => { throw new ImportCheckError(message); };
const emailKey = email => email?.trim().toLowerCase();
const fingerprint = record => createHash('sha256').update(JSON.stringify(record, (key, value) =>
  value?.type === 'Buffer' ? { type: 'Buffer', data: value.data } : value)).digest('hex');
const dateString = value => {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) fail('Source contains an invalid account timestamp.');
  return date.toISOString();
};
const photo = value => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol)) return url.toString();
  } catch { /* Reject unsupported metadata before importing any user. */ }
  fail('Source contains an invalid profile photo URL.');
};
const isBanned = (value, now) => {
  if (!value || value === '-infinity') return false;
  if (value === 'infinity') return true;
  const until = new Date(value).getTime();
  if (!Number.isFinite(until)) fail('Source contains an invalid ban timestamp.');
  return until > now;
};

export const prepareUsers = (users, identities, now = Date.now()) => {
  const byUser = new Map();
  for (const identity of identities) {
    if (!byUser.has(identity.user_id)) byUser.set(identity.user_id, []);
    byUser.get(identity.user_id).push(identity);
  }
  const records = users.filter(user => !user.deleted_at).map(user => {
    if (typeof user.id !== 'string' || !user.id || user.id.length > 128) fail('Source contains an invalid user ID.');
    if (!user.email || !/^[^\s@]+@[^\s@]+$/.test(user.email)) fail('Source contains a user without a supported email sign-in identity.');
    if (user.is_anonymous || user.phone) fail('Source contains anonymous or phone accounts that need a separate migration plan.');
    const metadata = user.raw_user_meta_data ?? {};
    const record = {
      uid: user.id,
      email: user.email,
      emailVerified: Boolean(user.email_confirmed_at),
      disabled: isBanned(user.banned_until, now),
      ...(metadata.display_name || metadata.full_name || metadata.name ? { displayName: String(metadata.display_name || metadata.full_name || metadata.name) } : {}),
      ...(metadata.avatar_url || metadata.picture ? { photoURL: photo(metadata.avatar_url || metadata.picture) } : {}),
      metadata: {
        ...(user.created_at ? { creationTime: dateString(user.created_at) } : {}),
        ...(user.last_sign_in_at ? { lastSignInTime: dateString(user.last_sign_in_at) } : {}),
      },
    };
    if (user.encrypted_password) {
      if (!/^\$2[aby]\$(?:0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/.test(user.encrypted_password)) fail('Source contains an unsupported password hash.');
      record.passwordHash = Buffer.from(user.encrypted_password, 'utf8');
    }
    const google = [];
    for (const identity of byUser.get(user.id) ?? []) {
      if (identity.provider === 'email') continue;
      if (identity.provider !== 'google') fail('Source contains an OAuth provider that this app does not support.');
      const data = identity.identity_data ?? {};
      const subject = data.sub ?? identity.provider_id;
      if (typeof subject !== 'string' || !subject || subject.length > 128) fail('Source contains a Google identity without a valid provider ID.');
      google.push({
        providerId: 'google.com', uid: subject,
        email: data.email ?? record.email,
        ...(data.full_name || data.name || record.displayName ? { displayName: data.full_name || data.name || record.displayName } : {}),
        ...(data.avatar_url || data.picture || record.photoURL ? { photoURL: photo(data.avatar_url || data.picture || record.photoURL) } : {}),
      });
    }
    if (google.length > 1) fail('Source contains multiple Google identities for one user.');
    if (google.length) record.providerData = google;
    if (!record.passwordHash && !google.length) fail('Source contains passwordless email accounts that need a separate sign-in migration plan.');
    record.customClaims = { [marker]: fingerprint(record) };
    return record;
  }).sort((a, b) => a.uid.localeCompare(b.uid));
  const seen = new Set();
  for (const record of records) {
    for (const key of [`uid:${record.uid}`, `email:${emailKey(record.email)}`, ...(record.providerData ?? []).map(p => `provider:${p.providerId}:${p.uid}`)]) {
      if (seen.has(key)) fail('Source contains duplicate account identifiers.');
      seen.add(key);
    }
  }
  return records;
};

export const verifyImportedUser = (record, user) => {
  const expectedProviders = (record.providerData ?? []).map(p => `${p.providerId}:${p.uid}`).sort();
  const actualProviders = user.providerData.filter(p => p.providerId !== 'password').map(p => `${p.providerId}:${p.uid}`).sort();
  if (user.uid !== record.uid || emailKey(user.email) !== emailKey(record.email)
    || user.emailVerified !== record.emailVerified || user.disabled !== record.disabled
    || (user.displayName ?? '') !== (record.displayName ?? '') || (user.photoURL ?? '') !== (record.photoURL ?? '')
    || JSON.stringify(expectedProviders) !== JSON.stringify(actualProviders)
    || user.customClaims?.[marker] !== record.customClaims[marker]) fail('An existing or imported Firebase account differs from the source. No account will be overwritten.');
};

export const preflightUsers = (records, existing) => {
  const byUid = new Map(existing.map(user => [user.uid, user]));
  const byEmail = new Map();
  const byProvider = new Map();
  for (const user of existing) {
    if (user.email) {
      const key = emailKey(user.email);
      if (byEmail.has(key) && byEmail.get(key) !== user.uid) fail('Firebase contains duplicate email identities; resolve them before migration.');
      byEmail.set(key, user.uid);
    }
    for (const provider of user.providerData ?? []) {
      const key = `${provider.providerId}:${provider.uid}`;
      if (byProvider.has(key) && byProvider.get(key) !== user.uid) fail('Firebase contains duplicate provider identities; resolve them before migration.');
      byProvider.set(key, user.uid);
    }
  }
  const pending = [], resumed = [];
  for (const record of records) {
    const owner = byEmail.get(emailKey(record.email));
    if (owner && owner !== record.uid) fail('A Firebase email already belongs to another UID. Migration stopped before overwriting or linking accounts.');
    for (const provider of record.providerData ?? []) {
      const owner = byProvider.get(`${provider.providerId}:${provider.uid}`);
      if (owner && owner !== record.uid) fail('A Firebase Google identity already belongs to another UID. Migration stopped.');
    }
    const user = byUid.get(record.uid);
    if (user) { verifyImportedUser(record, user); resumed.push(record); }
    else pending.push(record);
  }
  return { pending, resumed };
};

const listUsers = async auth => {
  const users = [];
  let token;
  do {
    const page = await auth.listUsers(1000, token);
    users.push(...page.users); token = page.pageToken;
  } while (token);
  return users;
};

export const importPreparedUsers = async (auth, records, apply = false) => {
  const { pending, resumed } = preflightUsers(records, await listUsers(auth));
  const report = { sourceUsers: records.length, pending: pending.length, alreadyVerified: resumed.length,
    passwordUsers: records.filter(r => r.passwordHash).length, googleUsers: records.filter(r => r.providerData?.length).length };
  if (!apply) return { status: 'read-only preflight', ...report };
  for (let offset = 0; offset < pending.length; offset += 1000) {
    const batch = pending.slice(offset, offset + 1000);
    // Recheck identifiers immediately before each batch. Writes/signups on both
    // old and new apps must stay paused throughout the migration.
    const latest = preflightUsers(batch, await listUsers(auth));
    if (latest.pending.length !== batch.length) fail('Firebase changed during import. Keep new-app signups paused and rerun the preflight.');
    const result = await auth.importUsers(batch, batch.some(r => r.passwordHash) ? { hash: { algorithm: 'BCRYPT' } } : undefined);
    if (result.failureCount || result.successCount !== batch.length) fail('Firebase reported a partial import. Rerun read-only preflight to identify verified users; no existing accounts will be overwritten.');
    const verifiedUsers = [];
    // Firebase batch lookup accepts at most 100 IDs, while import accepts 1000.
    for (let index = 0; index < batch.length; index += 100) {
      const verified = await auth.getUsers(batch.slice(index, index + 100).map(r => ({ uid: r.uid })));
      if (verified.notFound.length) fail('Firebase import count verification failed.');
      verifiedUsers.push(...verified.users);
    }
    if (verifiedUsers.length !== batch.length) fail('Firebase import count verification failed.');
    const byUid = new Map(verifiedUsers.map(user => [user.uid, user]));
    for (const record of batch) verifyImportedUser(record, byUid.get(record.uid));
  }
  return { status: 'verified', ...report,
    identityChecksum: createHash('sha256').update(records.map(r => `${r.uid}:${r.customClaims[marker]}\n`).join('')).digest('hex') };
};

const run = async () => {
  let source, app;
  try {
    const apply = process.argv.includes('--apply');
    if (apply && !process.argv.includes('--source-writes-paused')) fail('Pause writes and signups on both old and new apps, then use --source-writes-paused.');
    const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
    if (!projectId) fail('Fill FIREBASE_PROJECT_ID first.');
    let credential;
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const serviceAccount = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
      if (serviceAccount.project_id !== projectId) fail('Firebase service-account project does not match FIREBASE_PROJECT_ID.');
      credential = cert(serviceAccount);
    } else credential = applicationDefault();
    app = initializeApp({ credential, projectId }, 'blocklens-user-import');
    if (process.argv.includes('--check-access')) {
      if (apply) fail('--check-access is read-only; do not combine it with --apply.');
      const users = await listUsers(getAuth(app));
      console.log(JSON.stringify({ status: 'Firebase admin read access verified', users: users.length }, null, 2));
      return;
    }
    const sourceUrl = process.env.SUPABASE_DATABASE_URL?.trim();
    if (!sourceUrl) fail('Fill SUPABASE_DATABASE_URL in .env.local first.');
    const parsed = new URL(sourceUrl);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['require', 'verify-full'].includes(parsed.searchParams.get('sslmode'))) fail('Use a TLS-enabled Supabase Postgres connection.');
    if (/YOUR.PASSWORD|\[.*\]/i.test(decodeURIComponent(parsed.password))) fail('Replace the password placeholder in SUPABASE_DATABASE_URL before migration.');
    source = await connect(sourceUrl);
    await source.query('begin isolation level repeatable read read only');
    const users = await source.query('select to_jsonb(u) as record from auth.users u order by id');
    const identities = await source.query('select to_jsonb(i) as record from auth.identities i order by user_id, provider');
    const records = prepareUsers(users.rows.map(r => r.record), identities.rows.map(r => r.record));
    const factors = await source.query('select to_regclass($1) as table_name', ['auth.mfa_factors']);
    if (factors.rows[0].table_name) {
      const active = await source.query('select count(*)::text as count from auth.mfa_factors where status = $1 and user_id::text = any($2::text[])', ['verified', records.map(r => r.uid)]);
      if (BigInt(active.rows[0].count)) fail('Source users have verified MFA factors. Migration stopped to avoid dropping their protection.');
    }
    const report = await importPreparedUsers(getAuth(app), records, apply);
    await source.query('commit');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await source?.query('rollback').catch(() => {});
    console.error(error instanceof ImportCheckError ? error.message : 'Firebase user import failed. Check source access and Firebase admin permissions. Credentials, hashes, and user details were not logged.');
    process.exitCode = 1;
  } finally { await source?.end(); if (app) await deleteApp(app); }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
