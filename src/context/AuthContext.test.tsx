import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  changed: undefined as ((user: unknown) => void) | undefined,
  unsubscribe: vi.fn(), signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(), updateProfile: vi.fn(),
  google: vi.fn(), setGoogleParameters: vi.fn(), popupResolver: {},
  notify: undefined as ((user: unknown) => void) | undefined,
  auth: { currentUser: null as { uid: string; email: string; displayName: string } | null, authStateReady: vi.fn() },
}));
vi.mock('../lib/firebase', () => ({ isFirebaseConfigured: true, firebaseAuth: mocks.auth }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    mocks.notify = callback;
    mocks.changed = user => { mocks.auth.currentUser = user as typeof mocks.auth.currentUser; callback(user); };
    return mocks.unsubscribe;
  },
  signInWithEmailAndPassword: async (...args: unknown[]) => { const credential = await mocks.signIn(...args); mocks.auth.currentUser = credential.user; return credential; },
  createUserWithEmailAndPassword: async (...args: unknown[]) => { const credential = await mocks.signUp(...args); mocks.auth.currentUser = credential.user; return credential; },
  signOut: async (...args: unknown[]) => { await mocks.signOut(...args); mocks.auth.currentUser = null; }, updateProfile: mocks.updateProfile,
  signInWithPopup: async (...args: unknown[]) => { const credential = await mocks.google(...args); mocks.auth.currentUser = credential.user; return credential; }, browserPopupRedirectResolver: mocks.popupResolver,
  GoogleAuthProvider: class { setCustomParameters = mocks.setGoogleParameters; },
}));
import { AuthProvider, useAuth } from './AuthContext';

const firebaseUser = { uid: 'FirebaseUid_123', email: 'trader@example.com', displayName: 'Trader' };
const wrapper = ({ children }: React.PropsWithChildren) => <AuthProvider>{children}</AuthProvider>;
describe('Firebase auth context', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.currentUser = null; mocks.auth.authStateReady.mockResolvedValue(undefined); mocks.updateProfile.mockResolvedValue(undefined); });
  afterEach(cleanup);
  it('restores a Firebase session and uses its UID as the account ID', async () => {
    const { result, unmount } = renderHook(useAuth, { wrapper });
    expect(result.current.loading).toBe(true);
    act(() => mocks.changed!(firebaseUser));
    await waitFor(() => expect(result.current.user?.id).toBe(firebaseUser.uid));
    expect(result.current.loading).toBe(false);
    act(() => mocks.changed!(null));
    expect(result.current.user).toBeNull();
    unmount(); expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
  it('signs in with trimmed email and reports Firebase failures safely', async () => {
    mocks.signIn.mockResolvedValue({ user: firebaseUser });
    const { result } = renderHook(useAuth, { wrapper });
    await act(async () => { expect(await result.current.signIn(' trader@example.com ', 'password')).toEqual({ error: null }); });
    expect(mocks.signIn).toHaveBeenCalledWith(expect.anything(), 'trader@example.com', 'password');
    expect(result.current.user?.id).toBe(firebaseUser.uid);
    mocks.signIn.mockRejectedValue({ code: 'auth/invalid-credential', message: 'internal diagnostic' });
    await act(async () => { expect(await result.current.signIn('trader@example.com', 'wrong')).toEqual({ error: 'Email or password is incorrect.' }); });
  });
  it('creates a signed-in account and tolerates an optional name-update failure', async () => {
    mocks.signUp.mockResolvedValue({ user: firebaseUser });
    mocks.updateProfile.mockRejectedValue({ code: 'auth/network-request-failed' });
    const { result } = renderHook(useAuth, { wrapper });
    await act(async () => { expect(await result.current.signUp('trader@example.com', 'password', ' Trader ')).toEqual({ error: null, needsConfirmation: false }); });
    expect(mocks.updateProfile).toHaveBeenCalledWith(firebaseUser, { displayName: 'Trader' });
    expect(result.current.user?.id).toBe(firebaseUser.uid);
  });
  it('restores registration once when the optional name update invalidates its token', async () => {
    mocks.signUp.mockResolvedValue({ user: firebaseUser });
    mocks.signIn.mockResolvedValue({ user: firebaseUser });
    mocks.updateProfile.mockImplementation(async () => {
      act(() => mocks.changed!(null));
      throw { code: 'auth/user-token-expired' };
    });
    const { result } = renderHook(useAuth, { wrapper });
    await act(async () => {
      expect(await result.current.signUp(' trader@example.com ', 'password', 'Trader')).toEqual({ error: null, needsConfirmation: false });
    });
    expect(mocks.signUp).toHaveBeenCalledOnce();
    expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith(mocks.auth, 'trader@example.com', 'password');
    expect(result.current.user?.id).toBe(firebaseUser.uid);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
  it('keeps account loading until registration finishes even when an observer reports the new user', async () => {
    let finishProfile!: () => void;
    mocks.signUp.mockResolvedValue({ user: firebaseUser });
    mocks.updateProfile.mockImplementation(() => new Promise<void>(resolve => { finishProfile = resolve; }));
    const { result } = renderHook(useAuth, { wrapper });
    let registration!: ReturnType<typeof result.current.signUp>;
    await act(async () => { registration = result.current.signUp('trader@example.com', 'password', 'Trader'); });
    act(() => mocks.changed!(firebaseUser));
    expect(result.current.loading).toBe(true);
    await act(async () => { finishProfile(); await registration; });
    expect(result.current.loading).toBe(false);
    expect(result.current.user?.id).toBe(firebaseUser.uid);
  });
  it('does not invent a session or register twice when registration recovery fails', async () => {
    mocks.signUp.mockResolvedValue({ user: firebaseUser });
    mocks.signIn.mockRejectedValue({ code: 'auth/network-request-failed' });
    mocks.updateProfile.mockImplementation(async () => {
      mocks.changed!(null);
      throw { code: 'auth/user-token-expired' };
    });
    const { result } = renderHook(useAuth, { wrapper });
    await act(async () => {
      expect((await result.current.signUp('trader@example.com', 'password', 'Trader')).error).toContain('Your account was created');
    });
    expect(mocks.signUp).toHaveBeenCalledOnce();
    expect(mocks.signIn).toHaveBeenCalledOnce();
    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
  });
  it('respects disabled accounts instead of automatically signing them back in', async () => {
    mocks.signUp.mockResolvedValue({ user: firebaseUser });
    mocks.updateProfile.mockImplementation(async () => { mocks.changed!(null); throw { code: 'auth/user-disabled' }; });
    const { result } = renderHook(useAuth, { wrapper });
    await act(async () => { expect((await result.current.signUp('trader@example.com', 'password', 'Trader')).error).toBe('This account has been disabled.'); });
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(result.current.user).toBeNull();
  });
  it('ignores an older queued sign-out notification while Firebase has a valid session', () => {
    const { result } = renderHook(useAuth, { wrapper });
    act(() => mocks.changed!(firebaseUser));
    act(() => mocks.notify!(null));
    expect(result.current.user?.id).toBe(firebaseUser.uid);
    expect(result.current.error).toBeNull();
    act(() => mocks.changed!(null));
    expect(result.current.user).toBeNull();
    expect(result.current.error).toBe('Your session has ended. Please sign in again.');
  });
  it('awaits sign-out before clearing the account', async () => {
    mocks.signOut.mockRejectedValue({ code: 'auth/network-request-failed' });
    const { result } = renderHook(useAuth, { wrapper });
    act(() => mocks.changed!(firebaseUser));
    await act(async () => { expect((await result.current.signOut()).error).not.toBeNull(); });
    expect(result.current.user?.id).toBe(firebaseUser.uid);
    mocks.signOut.mockResolvedValue(undefined);
    await act(async () => { expect(await result.current.signOut()).toEqual({ error: null }); });
    expect(result.current.user).toBeNull();
  });
  it('signs in or registers through Google and keeps the Firebase UID', async () => {
    mocks.google.mockResolvedValue({ user: firebaseUser });
    const { result } = renderHook(useAuth, { wrapper });
    await act(async () => { expect(await result.current.signInWithGoogle()).toEqual({ error: null }); });
    expect(mocks.setGoogleParameters).toHaveBeenCalledWith({ prompt: 'select_account' });
    expect(mocks.google).toHaveBeenCalledWith(expect.anything(), expect.anything(), mocks.popupResolver);
    expect(result.current.user).toEqual({ id: firebaseUser.uid, email: firebaseUser.email, displayName: firebaseUser.displayName });
    expect(mocks.signUp).not.toHaveBeenCalled();
  });
  it.each([
    ['auth/popup-blocked', 'Allow pop-ups for this site, then try Google sign-in again.'],
    ['auth/popup-closed-by-user', 'Google sign-in was cancelled. Please try again.'],
    ['auth/account-exists-with-different-credential', 'This email uses another sign-in method. Sign in with that method first.'],
  ])('handles Google failure %s without creating a session', async (code, message) => {
    mocks.google.mockRejectedValue({ code, message: 'internal diagnostic' });
    const { result } = renderHook(useAuth, { wrapper });
    act(() => mocks.changed!(null));
    await act(async () => { expect(await result.current.signInWithGoogle()).toEqual({ error: message }); });
    expect(result.current.error).toBe(message);
    expect(result.current.user).toBeNull();
  });
});
