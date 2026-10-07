// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { importPreparedUsers, preflightUsers, prepareUsers } from './firebase-import.mjs';

const hash = '$2a$10$' + 'a'.repeat(53);
const source = (extra = {}) => ({ id: '11111111-1111-4111-8111-111111111111', email: 'trader@example.com',
  encrypted_password: hash, email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2025-12-01T01:02:03.456Z',
  raw_user_meta_data: { display_name: 'Trader' }, ...extra });
const firebaseUser = record => ({ uid: record.uid, email: record.email, emailVerified: record.emailVerified,
  disabled: record.disabled, displayName: record.displayName, photoURL: record.photoURL,
  customClaims: record.customClaims, providerData: record.providerData ?? [] });

describe('Supabase to Firebase user migration', () => {
  it('preserves the original UUID, bcrypt bytes, confirmed email, and Google identity', () => {
    const user = source();
    const [record] = prepareUsers([user], [{ user_id: user.id, provider: 'google', identity_data: { sub: 'google-subject', email: user.email } }]);
    expect(record.uid).toBe(user.id);
    expect(record.passwordHash.equals(Buffer.from(hash))).toBe(true);
    expect(record.emailVerified).toBe(true);
    expect(record.metadata.creationTime).toBe('2025-12-01T01:02:03.456Z');
    expect(record.providerData).toEqual([{ providerId: 'google.com', uid: 'google-subject', email: user.email, displayName: 'Trader' }]);
    expect(record.customClaims.blocklens_supabase_import).toMatch(/^[a-f0-9]{64}$/);
  });
  it('keeps bans disabled and excludes deleted accounts', () => {
    const records = prepareUsers([source({ banned_until: 'infinity' }), source({ id: 'deleted', deleted_at: '2026-01-01' })], []);
    expect(records).toHaveLength(1);
    expect(records[0].disabled).toBe(true);
  });
  it('rejects unsupported hashes, authentication methods, and duplicate emails before writes', () => {
    expect(() => prepareUsers([source({ encrypted_password: 'unsupported-hash' })], [])).toThrow('unsupported password hash');
    expect(() => prepareUsers([source({ encrypted_password: '' })], [])).toThrow('passwordless');
    expect(() => prepareUsers([source({ phone: '+12345678901' })], [])).toThrow('phone accounts');
    expect(() => prepareUsers([source(), source({ id: 'other-uid', email: 'TRADER@example.com' })], [])).toThrow('duplicate');
    expect(() => prepareUsers([source()], [{ user_id: source().id, provider: 'github' }])).toThrow('OAuth provider');
  });
  it('refuses an email or Google identity already owned by another Firebase UID', () => {
    const user = source();
    const records = prepareUsers([user], [{ user_id: user.id, provider: 'google', provider_id: 'google-subject' }]);
    expect(() => preflightUsers(records, [{ ...firebaseUser(records[0]), uid: 'different-uid' }])).toThrow('another UID');
    expect(() => preflightUsers(records, [{ ...firebaseUser(records[0]), uid: 'different-uid', email: 'different@example.com' }])).toThrow('Google identity');
  });
  it('resumes only a previously verified import with matching source fingerprint and account fields', () => {
    const records = prepareUsers([source()], []);
    expect(preflightUsers(records, [firebaseUser(records[0])])).toEqual({ pending: [], resumed: records });
    expect(() => preflightUsers(records, [{ ...firebaseUser(records[0]), customClaims: {} }])).toThrow('differs from the source');
    expect(() => preflightUsers(records, [{ ...firebaseUser(records[0]), emailVerified: false }])).toThrow('differs from the source');
  });
  it('performs a read-only preflight by default and stops before writes on collisions', async () => {
    const records = prepareUsers([source()], []);
    const auth = { listUsers: vi.fn().mockResolvedValue({ users: [] }), importUsers: vi.fn() };
    expect(await importPreparedUsers(auth, records)).toMatchObject({ status: 'read-only preflight', pending: 1 });
    expect(auth.importUsers).not.toHaveBeenCalled();
    auth.listUsers.mockResolvedValue({ users: [{ ...firebaseUser(records[0]), uid: 'different-uid' }] });
    await expect(importPreparedUsers(auth, records, true)).rejects.toThrow('another UID');
    expect(auth.importUsers).not.toHaveBeenCalled();
  });
  it('imports bounded batches and verifies each user through lookups capped at 100 IDs', async () => {
    const records = prepareUsers(Array.from({ length: 1101 }, (_, i) => source({ id: `uid-${i}`, email: `trader-${i}@example.com` })), []);
    const stored = new Map();
    const auth = {
      listUsers: vi.fn(async () => ({ users: [...stored.values()] })),
      importUsers: vi.fn(async (batch, options) => {
        expect(options).toEqual({ hash: { algorithm: 'BCRYPT' } });
        expect(batch.length).toBeLessThanOrEqual(1000);
        batch.forEach(record => stored.set(record.uid, firebaseUser(record)));
        return { successCount: batch.length, failureCount: 0 };
      }),
      getUsers: vi.fn(async ids => {
        expect(ids.length).toBeLessThanOrEqual(100);
        return { users: ids.map(({ uid }) => stored.get(uid)), notFound: [] };
      }),
    };
    expect(await importPreparedUsers(auth, records, true)).toMatchObject({ status: 'verified', sourceUsers: 1101 });
    expect(auth.importUsers).toHaveBeenCalledTimes(2);
    expect(stored.size).toBe(1101);
  });
  it('reports a partial import and permits a verified retry without overwriting completed users', async () => {
    const records = prepareUsers([source(), source({ id: 'other-uid', email: 'other@example.com' })], []);
    const stored = new Map();
    const auth = {
      listUsers: vi.fn(async () => ({ users: [...stored.values()] })),
      importUsers: vi.fn(async batch => {
        stored.set(batch[0].uid, firebaseUser(batch[0]));
        return { successCount: 1, failureCount: 1 };
      }),
    };
    await expect(importPreparedUsers(auth, records, true)).rejects.toThrow('partial import');
    expect(await importPreparedUsers(auth, records)).toMatchObject({ alreadyVerified: 1, pending: 1 });
  });
});
