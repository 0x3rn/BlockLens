import { deleteApp, getApps } from 'firebase/app';
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Node's Firebase entry point replaces browser persistence with memory. Load
// the real browser SDK to exercise storage and token refresh in jsdom.
vi.mock('firebase/auth', () => vi.importActual<typeof import('firebase/auth')>(
  '../../node_modules/@firebase/auth/dist/esm/index.js',
));

const email = 'session-test@example.com';
const uid = 'session-test-user';
const token = () => [
  btoa(JSON.stringify({ alg: 'RS256' })),
  btoa(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), auth_time: Math.floor(Date.now() / 1000) })),
  'test-signature',
].join('.');

const loadAuth = async () => {
  vi.resetModules();
  const module = await import('./firebase');
  await module.firebaseAuth!.authStateReady();
  return module;
};

describe('Firebase browser session persistence', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-api-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'test.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test');
    vi.stubEnv('VITE_FIREBASE_APP_ID', 'test-app');
    localStorage.clear();
    sessionStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('accounts:signUp')) return new Response(JSON.stringify({ localId: uid, email, idToken: token(), refreshToken: 'test-refresh', expiresIn: '3600' }));
      if (url.includes('accounts:lookup')) return new Response(JSON.stringify({ users: [{ localId: uid, email, emailVerified: false, providerUserInfo: [{ providerId: 'password', email }] }] }));
      if (url.includes('securetoken')) return new Response(JSON.stringify({ user_id: uid, access_token: token(), id_token: token(), refresh_token: 'test-refresh', expires_in: '3600' }));
      throw new Error('Unexpected Firebase request');
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    for (const app of getApps()) await deleteApp(app);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('restores a saved user and refreshes an expired token without clearing the session', async () => {
    const first = await loadAuth();
    await createUserWithEmailAndPassword(first.firebaseAuth!, email, 'test-password');
    expect(Object.keys(localStorage).some(key => key.startsWith('firebase:authUser:'))).toBe(true);
    await deleteApp(first.firebaseAuth!.app);
    const restored = await loadAuth();
    expect(restored.firebaseAuth!.currentUser?.uid).toBe(uid);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 70 * 60 * 1000);
    expect(await restored.getAccountToken()).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('securetoken'))).toBe(true);
    expect(restored.firebaseAuth!.currentUser?.uid).toBe(uid);
  });

  it('uses session storage when localStorage and IndexedDB are blocked, including after reload', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    vi.stubGlobal('indexedDB', undefined);
    const first = await loadAuth();
    await createUserWithEmailAndPassword(first.firebaseAuth!, email, 'test-password');
    expect(Object.keys(sessionStorage).some(key => key.startsWith('firebase:authUser:'))).toBe(true);
    await deleteApp(first.firebaseAuth!.app);
    const restored = await loadAuth();
    expect(restored.firebaseAuth!.currentUser?.uid).toBe(uid);
    await signOut(restored.firebaseAuth!);
    await deleteApp(restored.firebaseAuth!.app);
    expect((await loadAuth()).firebaseAuth!.currentUser).toBeNull();
  });

  it('honors an explicit sign-out from another tab', async () => {
    const { firebaseAuth } = await loadAuth();
    await createUserWithEmailAndPassword(firebaseAuth!, email, 'test-password');
    const key = Object.keys(localStorage).find(key => key.startsWith('firebase:authUser:'))!;
    const oldValue = localStorage.getItem(key);
    localStorage.removeItem(key);
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: null, storageArea: localStorage }));
    await vi.waitFor(() => expect(firebaseAuth!.currentUser).toBeNull());
  });

  it('keeps a valid session when a token refresh fails because the network is unavailable', async () => {
    const { firebaseAuth, getAccountToken } = await loadAuth();
    await createUserWithEmailAndPassword(firebaseAuth!, email, 'test-password');
    fetchMock.mockRejectedValue(new TypeError('Network unavailable'));
    await expect(getAccountToken(true)).rejects.toMatchObject({ code: 'auth/network-request-failed' });
    expect(firebaseAuth!.currentUser?.uid).toBe(uid);
  });

  it('still clears a session when Firebase rejects its refresh token', async () => {
    const { firebaseAuth, getAccountToken } = await loadAuth();
    await createUserWithEmailAndPassword(firebaseAuth!, email, 'test-password');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'TOKEN_EXPIRED' } }), { status: 400 }));
    await expect(getAccountToken(true)).rejects.toMatchObject({ code: 'auth/user-token-expired' });
    expect(firebaseAuth!.currentUser).toBeNull();
  });
});
