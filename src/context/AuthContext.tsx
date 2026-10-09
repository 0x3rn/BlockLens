import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { browserPopupRedirectResolver, createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut as firebaseSignOut, updateProfile } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { firebaseAuth, isFirebaseConfigured } from '../lib/firebase';
import { verifyPasswordAuth } from '../services/authVerification';

type AccountUser = { id: string; email: string | null; displayName: string | null };
type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  user: AccountUser | null;
  error: string | null;
  signIn: (email: string, password: string, turnstileToken: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, displayName: string | undefined, turnstileToken: string) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut: () => Promise<{ error: string | null }>;
};

const unavailable = 'Sign-in is temporarily unavailable. Please try again later.';
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
  if (code === 'TURNSTILE_VERIFICATION_FAILED') return 'Please complete verification and try again.';
  if (code === 'TURNSTILE_UNAVAILABLE') return unavailable;
  if (['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/wrong-password', 'auth/user-not-found'].includes(code)) return 'Email or password is incorrect.';
  if (code === 'auth/email-already-in-use') return 'An account with this email already exists.';
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  if (code === 'auth/weak-password') return 'Use a password with at least six characters.';
  if (code === 'auth/password-does-not-meet-requirements') return 'This password doesn’t meet the requirements. Please choose a stronger password.';
  if (code === 'auth/too-many-requests') return 'Too many sign-in attempts. Please wait and try again.';
  if (code === 'auth/user-disabled') return 'This account has been disabled.';
  if (code === 'auth/popup-blocked') return 'Allow pop-ups for this site, then try Google sign-in again.';
  if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(code)) return 'Google sign-in was cancelled. Please try again.';
  if (code === 'auth/account-exists-with-different-credential') return 'This email uses another sign-in method. Sign in with that method first.';
  if (code === 'auth/unauthorized-domain') return 'Google sign-in is temporarily unavailable. Please sign in with email or try again later.';
  if (['auth/operation-not-allowed', 'auth/configuration-not-found'].includes(code)) return 'Account sign-in is unavailable right now. Please try again later.';
  if (code === 'auth/network-request-failed') return 'Check your connection and try again.';
  if (['auth/user-token-expired', 'auth/invalid-user-token', 'auth/requires-recent-login'].includes(code)) return 'Please sign in again to continue.';
  return 'We couldn’t complete your request. Please try again.';
};

const accountUser = (user: User | null): AccountUser | null => user
  ? { id: user.uid, email: user.email, displayName: user.displayName } : null;

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const [error, setError] = useState<string | null>(null);
  const registering = useRef(false);
  const signingOut = useRef(false);
  const previousUserId = useRef<string | null>(null);

  const publishSession = useCallback(() => {
    // Queued observer callbacks and completed requests can describe an older
    // session. Firebase's current user is the authority for account access.
    const next = accountUser(firebaseAuth?.currentUser ?? null);
    if (next) setError(null);
    else if (previousUserId.current && !registering.current && !signingOut.current) {
      setError('Your session has ended. Please sign in again.');
    }
    previousUserId.current = next?.id ?? null;
    setUser(previous => previous?.id === next?.id && previous?.email === next?.email
      && previous?.displayName === next?.displayName ? previous : next);
  }, []);

  useEffect(() => {
    if (!firebaseAuth) { setLoading(false); return undefined; }
    return onAuthStateChanged(firebaseAuth, () => {
      publishSession();
      if (!registering.current) setLoading(false);
    }, (authError) => { setError(readableAuthError(authError)); setLoading(false); });
  }, [publishSession]);

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
        if (firebaseAuth.currentUser?.uid !== credential.user.uid) throw { code: 'auth/user-token-expired' };
        publishSession();
        return { error: null };
      } catch (failure) {
        const message = readableAuthError(failure); setError(message); return { error: message };
      }
    },
    signIn: async (email, password, turnstileToken) => {
      if (!firebaseAuth) return { error: unavailable };
      setError(null);
      try {
        await verifyPasswordAuth('sign-in', turnstileToken);
        await firebaseAuth.authStateReady();
        const credential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
        if (firebaseAuth.currentUser?.uid !== credential.user.uid) throw { code: 'auth/user-token-expired' };
        publishSession();
        return { error: null };
      } catch (failure) {
        const message = readableAuthError(failure); setError(message); return { error: message };
      }
    },
    signUp: async (email, password, displayName, turnstileToken) => {
      if (!firebaseAuth) return { error: unavailable, needsConfirmation: false };
      setError(null);
      registering.current = true;
      setLoading(true);
      let created = false;
      try {
        await verifyPasswordAuth('sign-up', turnstileToken);
        await firebaseAuth.authStateReady();
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
        created = true;
        if (displayName?.trim()) {
          try { await updateProfile(credential.user, { displayName: displayName.trim().slice(0, 80) }); }
          catch (failure) {
            // An expired profile-update token makes the SDK sign out. Restore
            // the newly created account once using this registration's credentials.
            if (failure && typeof failure === 'object' && 'code' in failure
              && failure.code === 'auth/user-token-expired' && !firebaseAuth.currentUser) {
              await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
            } else if (firebaseAuth.currentUser?.uid !== credential.user.uid) throw failure;
            // Other optional-name failures leave the signed-in account usable.
          }
        }
        if (firebaseAuth.currentUser?.uid !== credential.user.uid) throw { code: 'auth/user-token-expired' };
        publishSession();
        return { error: null, needsConfirmation: false };
      } catch (failure) {
        publishSession();
        const disabled = failure && typeof failure === 'object' && 'code' in failure && failure.code === 'auth/user-disabled';
        const message = created && !disabled
          ? 'Your account was created, but we couldn’t sign you in. Please sign in with your email and password.'
          : readableAuthError(failure);
        setError(message);
        return { error: message, needsConfirmation: false };
      } finally {
        registering.current = false;
        setLoading(false);
      }
    },
    signOut: async () => {
      if (!firebaseAuth) return { error: null };
      signingOut.current = true;
      try {
        await firebaseSignOut(firebaseAuth); publishSession(); setError(null); return { error: null };
      } catch (failure) {
        const message = readableAuthError(failure); setError(message); return { error: message };
      } finally { signingOut.current = false; }
    },
  }), [error, loading, publishSession, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => useContext(AuthContext);
