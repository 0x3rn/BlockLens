import React, { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Cloud, LogIn, LogOut, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../hooks/usePageMeta';

const AccountPage: React.FC = () => {
  const { configured, loading, user, signIn, signUp, signOut } = useAuth();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  usePageMeta('Account', 'Sign in to sync your BlockLens portfolio, watchlist, and alerts across devices.');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = mode === 'sign-in'
      ? await signIn(email, password)
      : await signUp(email, password, displayName);
    const resultError = result.error;
    const needsConfirmation = mode === 'sign-up' && 'needsConfirmation' in result && result.needsConfirmation;
    if (resultError) setMessage(resultError);
    else if (needsConfirmation) setMessage('Check your email to confirm the account, then sign in.');
    else setMessage('Account ready. Your data is syncing.');
    setBusy(false);
  };

  const handleSignOut = async () => {
    setBusy(true);
    setMessage(null);
    const result = await signOut();
    setMessage(result.error ?? 'Signed out. Your local data is still available on this device.');
    setBusy(false);
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
          <div><span className="eyebrow">Local mode</span><h2>Keep using BlockLens</h2><p>Your portfolio, watchlist, and alerts are saved on this device. Account sync is unavailable right now.</p></div>
          <Link className="secondary-button" to="/watchlist">Continue <ArrowRight size={15} aria-hidden="true" /></Link>
        </section>
      ) : loading ? (
        <div className="account-card account-loading" role="status"><span className="route-loader-spinner" /> Loading account</div>
      ) : user ? (
        <section className="account-card account-signed-in">
          <div className="account-user-mark"><UserRound size={20} aria-hidden="true" /></div>
          <div><span className="eyebrow">Signed in</span><h2>{user.email}</h2></div>
          <button type="button" className="secondary-button" onClick={() => void handleSignOut()} disabled={busy}><LogOut size={15} aria-hidden="true" /> {busy ? 'Signing out' : 'Sign out'}</button>
        </section>
      ) : (
        <section className="account-layout">
          <form className="form-card account-form" onSubmit={(event) => void submit(event)}>
            <div className="section-heading compact-heading"><div><h2>{mode === 'sign-in' ? 'Sign in' : 'Create your account'}</h2></div></div>
            {mode === 'sign-up' && <label><span>Name (optional)</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" maxLength={80} /></label>}
            <label><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
            <label><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={6} required /></label>
            {message && <p className="account-message" role="status">{message}</p>}
            <button type="submit" className="primary-button" disabled={busy}><LogIn size={15} aria-hidden="true" /> {busy ? (mode === 'sign-in' ? 'Signing in' : 'Creating account') : (mode === 'sign-in' ? 'Sign in' : 'Create account')}</button>
            <button type="button" className="account-mode-toggle" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage(null); }}>{mode === 'sign-in' ? 'Need an account? Create one' : 'Already have an account? Sign in'}</button>
          </form>
        </section>
      )}
    </main>
  );
};

export default AccountPage;
