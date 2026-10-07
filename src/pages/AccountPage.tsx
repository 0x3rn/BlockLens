import React, { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Cloud, LogIn, LogOut, UserRound } from 'lucide-react';
import { readableAuthError, useAuth } from '../context/AuthContext';
import { usePageMeta } from '../hooks/usePageMeta';

const AccountPage: React.FC = () => {
  const { configured, user, error: authError, signIn, signInWithGoogle, signUp, signOut } = useAuth();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pendingAction, setPendingAction] = useState<'email' | 'google' | 'sign-out' | null>(null);
  const busy = pendingAction !== null;
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setMessage(null);
    setPassword('');
  }, [user?.id]);
  usePageMeta('Account', 'Sign in to sync your BlockLens portfolio, watchlist, and alerts across devices.');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setPendingAction('email');
    setMessage(null);
    try {
      const result = mode === 'sign-in'
        ? await signIn(email, password)
        : await signUp(email, password, displayName);
      setMessage(result.error);
    } catch (failure) { setMessage(readableAuthError(failure)); }
    finally { setPendingAction(null); }
  };

  const handleSignOut = async () => {
    if (busy) return;
    setPendingAction('sign-out');
    setMessage(null);
    try {
      const result = await signOut();
      setMessage(result.error);
      if (!result.error) setMode('sign-in');
    } catch (failure) { setMessage(readableAuthError(failure)); }
    finally { setPendingAction(null); }
  };

  const handleGoogleSignIn = async () => {
    if (busy) return;
    setPendingAction('google');
    setMessage(null);
    try {
      const result = await signInWithGoogle();
      setMessage(result.error);
    } catch (failure) { setMessage(readableAuthError(failure)); }
    finally { setPendingAction(null); }
  };

  return (
    <main className="app-container page-stack account-page">
      <header className="page-intro page-header-card account-header">
        <div className="markets-title-wrap">
          <span className="markets-icon account-icon"><UserRound size={23} aria-hidden="true" /></span>
          <div><h1>Account</h1><p>Sync your portfolio, watchlist, and alerts across your devices.</p></div>
        </div>
      </header>

      {!configured ? (
        <section className="account-card account-setup-card">
          <Cloud size={25} aria-hidden="true" />
          <div><h2>Sign-in is temporarily unavailable</h2><p>You can still use your portfolio, watchlist, and alerts on this device. Please try signing in again later.</p></div>
          <Link className="secondary-button" to="/watchlist">Continue <ArrowRight size={15} aria-hidden="true" /></Link>
        </section>
      ) : user ? (
        <section className="account-card account-signed-in">
          <div className="account-user-mark"><UserRound size={20} aria-hidden="true" /></div>
          <div><span className="eyebrow">Signed in</span><h2>{user.email}</h2></div>
          <button type="button" className="secondary-button" onClick={() => void handleSignOut()} disabled={busy}><LogOut size={15} aria-hidden="true" /> {pendingAction === 'sign-out' ? 'Signing out…' : 'Sign out'}</button>
        </section>
      ) : (
        <section className="account-layout">
          <form className="form-card account-form" onSubmit={(event) => void submit(event)}>
            <div className="section-heading compact-heading"><div><h2>{mode === 'sign-in' ? 'Sign in' : 'Create your account'}</h2></div></div>
            <button type="button" className="secondary-button account-google-button" onClick={() => void handleGoogleSignIn()} disabled={busy}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
                <path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24v7.42h11a9.4 9.4 0 0 1-4.08 6.17v5h6.61c3.87-3.56 6.08-8.81 6.08-14.67Z" />
                <path fill="#34A853" d="M24 44c5.51 0 10.13-1.83 13.51-4.87l-6.61-5c-1.84 1.23-4.2 1.97-6.9 1.97-5.3 0-9.8-3.58-11.41-8.4H5.76v5.16A20.4 20.4 0 0 0 24 44Z" />
                <path fill="#FBBC05" d="M12.59 27.7a12.2 12.2 0 0 1 0-7.4v-5.16H5.76a20 20 0 0 0 0 17.72l6.83-5.16Z" />
                <path fill="#EA4335" d="M24 11.9c3 0 5.68 1.03 7.8 3.05l5.84-5.84A19.5 19.5 0 0 0 24 4 20.4 20.4 0 0 0 5.76 15.14l6.83 5.16C14.2 15.48 18.7 11.9 24 11.9Z" />
              </svg>
              {pendingAction === 'google' ? 'Connecting to Google' : 'Continue with Google'}
            </button>
            <div className="account-auth-divider"><span>or continue with email</span></div>
            {mode === 'sign-up' && <label><span>Name (optional)</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" maxLength={80} /></label>}
            <label><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
            <label><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={6} required /></label>
            {(message || authError) && <p className="account-message" role="alert">{message || authError}</p>}
            <button type="submit" className="primary-button" disabled={busy}><LogIn size={15} aria-hidden="true" /> {pendingAction === 'email' ? (mode === 'sign-in' ? 'Signing in' : 'Creating account') : (mode === 'sign-in' ? 'Sign in' : 'Create account')}</button>
            <button type="button" className="account-mode-toggle" disabled={busy} onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage(null); }}>{mode === 'sign-in' ? 'Need an account? Create one' : 'Already have an account? Sign in'}</button>
          </form>
        </section>
      )}
      {configured && user && (message || authError) && <p className="account-message" role="alert">{message || authError}</p>}
    </main>
  );
};

export default AccountPage;
