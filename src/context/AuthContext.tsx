import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { browserPopupRedirectResolver, createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut as firebaseSignOut, updateProfile } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { firebaseAuth, isFirebaseConfigured } from '../lib/firebase';

type AccountUser = { id: string; email: string | null; displayName: string | null };
type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  user: AccountUser | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut: () => Promise<{ error: string | null }>;
};

const unavailable = 'Account sync is unavailable right now.';
const disabledAuth: AuthContextValue = {
  configured: false, loading: false, user: null, error: null,
  signIn: async () => ({ error: unavailable }),
  signInWithGoogle: async () => ({ error: unavailable }),
  signUp: async () => ({ error: unavailable, needsConfirmation: false }),
  signOut: async () => ({ error: null }),
};
const AuthContext = createContext<AuthContextValue>(disabledAuth);

export const readableAuthError = (error: unknown): string => {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/wrong-password', 'auth/user-not-found'].includes(code)) return 'Email or password is incorrect.';
  if (code === 'auth/email-already-in-use') return 'An account with this email already exists.';
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') return 'Choose a stronger password with at least six characters.';
  if (code === 'auth/too-many-requests') return 'Too many sign-in attempts. Please wait and try again.';
  if (code === 'auth/user-disabled') return 'This account has been disabled.';
  if (code === 'auth/popup-blocked') return 'Allow pop-ups for this site, then try Google sign-in again.';
  if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(code)) return 'Google sign-in was cancelled. Please try again.';
  if (code === 'auth/account-exists-with-different-credential') return 'This email uses another sign-in method. Sign in with that method first.';
  if (code === 'auth/unauthorized-domain') return 'Google sign-in is unavailable on this address right now.';
  if (['auth/operation-not-allowed', 'auth/configuration-not-found'].includes(code)) return 'Account sign-in is unavailable right now. Please try again later.';
  if (code === 'auth/network-request-failed') return 'We couldn’t connect to sign-in. Check your connection and try again.';
  if (['auth/user-token-expired', 'auth/invalid-user-token', 'auth/requires-recent-login'].includes(code)) return 'Your session has expired. Please sign in again.';
  return 'Something went wrong. Please try again.';
};

const accountUser = (user: User | null): AccountUser | null => user
  ? { id: user.uid, email: user.email, displayName: user.displayName } : null;

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseAuth) { setLoading(false); return undefined; }
    return onAuthStateChanged(firebaseAuth, (nextUser) => {
      setUser(accountUser(nextUser)); setLoading(false);
    }, (authError) => { setError(readableAuthError(authError)); setLoading(false); });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured: isFirebaseConfigured, loading, user, error,
    signInWithGoogle: async () => {
      if (!firebaseAuth) return { error: unavailable };
      setError(null);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        // Open from the button's user gesture. Initialize popup support only
        // for this flow so email/password session restoration stays independent.
        const credential = await signInWithPopup(firebaseAuth, provider, browserPopupRedirectResolver);
        setUser(accountUser(credential.user));
        return { error: null };
      } catch (failure) {
        const message = readableAuthError(failure); setError(message); return { error: message };
      }
    },
    signIn: async (email, password) => {
      if (!firebaseAuth) return { error: unavailable };
      setError(null);
      try {
        const credential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
        setUser(accountUser(credential.user));
        return { error: null };
      } catch (failure) {
        const message = readableAuthError(failure); setError(message); return { error: message };
      }
    },
    signUp: async (email, password, displayName) => {
      if (!firebaseAuth) return { error: unavailable, needsConfirmation: false };
      setError(null);
      try {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
        if (displayName?.trim()) {
          // Name is optional: a profile-update failure must not present a
          // successfully created account as a failed registration.
          try { await updateProfile(credential.user, { displayName: displayName.trim().slice(0, 80) }); }
          catch { /* The account remains usable with its email display name. */ }
        }
        setUser(accountUser(credential.user));
        return { error: null, needsConfirmation: false };
      } catch (failure) {
        const message = readableAuthError(failure); setError(message); return { error: message, needsConfirmation: false };
      }
    },
    signOut: async () => {
      if (!firebaseAuth) return { error: null };
      try {
        await firebaseSignOut(firebaseAuth); setUser(null); setError(null); return { error: null };
      } catch (failure) {
        const message = readableAuthError(failure); setError(message); return { error: message };
      }
    },
  }), [error, loading, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => useContext(AuthContext);
