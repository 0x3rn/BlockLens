// @vitest-environment node
import { SignJWT, generateKeyPair } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ key: undefined as CryptoKey | undefined }));
vi.mock('jose', async (original) => ({
  ...await original<typeof import('jose')>(),
  // Tests use generated RSA keys in place of Google's X.509 certificate.
  // JWT signature validation itself runs through the real JOSE implementation.
  importX509: vi.fn(async () => fixture.key),
}));
const projectId = 'blocklens-test';
let privateKey: CryptoKey;
let verify: typeof import('./_firebase-auth')['verifyFirebaseUser'];
let request: ReturnType<typeof vi.fn>;
const token = (claims: Record<string, unknown> = {}, kid = 'google-key', signingKey = privateKey) => {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({ sub: 'FirebaseUid_ABC123', aud: projectId, iss: `https://securetoken.google.com/${projectId}`, exp: now + 3_600, iat: now - 1, auth_time: now - 5, email: 'trader@example.com', name: 'Trader', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid }).sign(signingKey);
};

describe('Firebase server authentication', () => {
  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    fixture.key = pair.publicKey; privateKey = pair.privateKey;
  });
  beforeEach(async () => {
    vi.resetModules();
    verify = (await import('./_firebase-auth')).verifyFirebaseUser;
    request = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ 'google-key': 'test-certificate' }), { headers: { 'Cache-Control': 'public, max-age=3600' } }));
    vi.stubGlobal('fetch', request);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('verifies signed Firebase tokens and accepts a non-UUID UID', async () => {
    const identity = await verify(`Bearer ${await token()}`, { FIREBASE_PROJECT_ID: projectId });
    expect(identity).toEqual({ id: 'FirebaseUid_ABC123', email: 'trader@example.com', displayName: 'Trader' });
    expect(request.mock.calls[0][0]).toBe('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
    expect(request.mock.calls[0][1].headers).toBeUndefined();
  });
  it('rejects another project, expired tokens, future authentication, and invalid UIDs', async () => {
    const now = Math.floor(Date.now() / 1_000);
    for (const claims of [
      { aud: 'other-project' }, { iss: 'https://securetoken.google.com/other-project' },
      { exp: now - 1 }, { iat: now + 60 }, { auth_time: now + 60 }, { auth_time: undefined },
      { sub: '' }, { sub: 'a'.repeat(129) },
    ]) await expect(verify(`Bearer ${await token(claims)}`, { FIREBASE_PROJECT_ID: projectId })).rejects.toMatchObject({ status: 401 });
  });
  it('accepts a freshly issued token when Google is a second ahead of the server', async () => {
    const now = Math.floor(Date.now() / 1_000);
    const identity = await verify(`Bearer ${await token({ iat: now + 1, auth_time: now + 1 })}`, { FIREBASE_PROJECT_ID: projectId });
    expect(identity.id).toBe('FirebaseUid_ABC123');
  });
  it('rejects forged signatures, unknown keys, and malformed authorization', async () => {
    const wrongKey = (await generateKeyPair('RS256')).privateKey;
    await expect(verify(`Bearer ${await token({}, 'google-key', wrongKey)}`, { FIREBASE_PROJECT_ID: projectId })).rejects.toMatchObject({ status: 401 });
    await expect(verify(`Bearer ${await token({}, 'unknown-key')}`, { FIREBASE_PROJECT_ID: projectId })).rejects.toMatchObject({ status: 401 });
    for (const header of [null, 'Basic secret', 'Bearer forged', 'Bearer two tokens']) {
      await expect(verify(header, { FIREBASE_PROJECT_ID: projectId })).rejects.toMatchObject({ status: 401 });
    }
  });
  it('fails closed when configuration or public certificates are unavailable', async () => {
    await expect(verify(`Bearer ${await token()}`, {})).rejects.toMatchObject({ status: 503 });
    request.mockRejectedValue(new Error('network unavailable'));
    await expect(verify(`Bearer ${await token()}`, { FIREBASE_PROJECT_ID: projectId })).rejects.toMatchObject({ status: 503 });
  });
  it('caches public certificates according to their expiry', async () => {
    const signed = await token();
    await verify(`Bearer ${signed}`, { FIREBASE_PROJECT_ID: projectId });
    await verify(`Bearer ${signed}`, { FIREBASE_PROJECT_ID: projectId });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
