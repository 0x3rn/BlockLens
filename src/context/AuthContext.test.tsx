import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  changed: undefined as ((user: unknown) => void) | undefined,
  unsubscribe: vi.fn(), signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(), updateProfile: vi.fn(),
  google: vi.fn(), setGoogleParameters: vi.fn(), popupResolver: {},
}));
vi.mock('../lib/firebase', () => ({ isFirebaseConfigured: true, firebaseAuth: { name: 'blocklens' } }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => { mocks.changed = callback; return mocks.unsubscribe; },
  signInWithEmailAndPassword: mocks.signIn, createUserWithEmailAndPassword: mocks.signUp,
  signOut: mocks.signOut, updateProfile: mocks.updateProfile,
  signInWithPopup: mocks.google, browserPopupRedirectResolver: mocks.popupResolver,
  GoogleAuthProvider: class { setCustomParameters = mocks.setGoogleParameters; },
}));
import { AuthProvider, useAuth } from './AuthContext';

const firebaseUser = { uid: 'FirebaseUid_123', email: 'trader@example.com', displayName: 'Trader' };
const wrapper = ({ children }: React.PropsWithChildren) => <AuthProvider>{children}</AuthProvider>;
describe('Firebase auth context', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.updateProfile.mockResolvedValue(undefined); });
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
