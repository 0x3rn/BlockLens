import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  user: User | null;
  session: Session | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut: () => Promise<{ error: string | null }>;
};

const disabledAuth: AuthContextValue = {
  configured: false,
  loading: false,
  user: null,
  session: null,
  error: null,
  signIn: async () => ({ error: 'Account sync is not configured yet.' }),
  signUp: async () => ({ error: 'Account sync is not configured yet.', needsConfirmation: false }),
  signOut: async () => ({ error: null }),
};

const AuthContext = createContext<AuthContextValue>(disabledAuth);

const readableAuthError = (message: string) => {
  if (/invalid login credentials/i.test(message)) return 'Email or password is incorrect.';
  if (/user already registered/i.test(message)) return 'An account with this email already exists.';
  if (/password should be at least/i.test(message)) return 'Use a password with at least six characters.';
  return message;
};

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return undefined;
    }

    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setLoading(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured: isSupabaseConfigured,
    loading,
    user: session?.user ?? null,
    session,
    error,
    signIn: async (email, password) => {
      if (!supabase) return { error: 'Account sync is not configured yet.' };
      setError(null);
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      const message = result.error ? readableAuthError(result.error.message) : null;
      setError(message);
      return { error: message };
    },
    signUp: async (email, password, displayName) => {
      if (!supabase) return { error: 'Account sync is not configured yet.', needsConfirmation: false };
      setError(null);
      const result = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: displayName?.trim() || undefined } },
      });
      const message = result.error ? readableAuthError(result.error.message) : null;
      setError(message);
      return { error: message, needsConfirmation: !message && !result.data.session };
    },
    signOut: async () => {
      if (!supabase) return { error: null };
      const result = await supabase.auth.signOut();
      const message = result.error ? readableAuthError(result.error.message) : null;
      setError(message);
      return { error: message };
    },
  }), [error, loading, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  return useContext(AuthContext);
};
