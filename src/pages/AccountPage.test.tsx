import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  google: vi.fn(), signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(),
  auth: { loading: false, user: null as { id: string; email: string } | null, error: null as string | null },
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({
  configured: true, ...mocks.auth,
  signInWithGoogle: mocks.google, signIn: mocks.signIn, signUp: mocks.signUp, signOut: mocks.signOut,
}), readableAuthError: () => 'We couldn’t complete your request. Please try again.' }));
import AccountPage from './AccountPage';
import type { TurnstileApi } from '../components/TurnstileVerification';

let widgets: Array<Parameters<TurnstileApi['render']>[1]>;
let widgetApi: TurnstileApi;
const verify = async (token = 'fresh-auth-token') => {
  await waitFor(() => expect(widgets.length).toBeGreaterThan(0));
  act(() => widgets.at(-1)!.callback(token));
};

describe('Google sign-in on the account page', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.auth.loading = false; mocks.auth.user = null; mocks.auth.error = null;
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'public-test-key');
    widgets = [];
    widgetApi = { ready: vi.fn(), render: vi.fn((_container, options) => { widgets.push(options); return `widget-${widgets.length}`; }), reset: vi.fn(), remove: vi.fn() };
    window.turnstile = widgetApi;
  });
  afterEach(() => { cleanup(); delete window.turnstile; vi.unstubAllEnvs(); });
  it('shows the sign-in form immediately while Firebase checks for a saved session', () => {
    mocks.auth.loading = true;
    const view = render(<MemoryRouter><AccountPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    expect(screen.queryByText(/Loading.*account/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'trader@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    mocks.auth.loading = false;
    view.rerender(<MemoryRouter><AccountPage /></MemoryRouter>);
    expect(screen.getByLabelText('Email')).toHaveValue('trader@example.com');
    expect(screen.getByLabelText('Password')).toHaveValue('password');
  });
  it('replaces the sign-in form with the account when a saved session is restored', () => {
    mocks.auth.loading = true;
    const view = render(<MemoryRouter><AccountPage /></MemoryRouter>);
    mocks.auth.user = { id: 'uid', email: 'trader@example.com' };
    mocks.auth.loading = false;
    view.rerender(<MemoryRouter><AccountPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'trader@example.com' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });
  it('keeps registration progress on its button while session initialization is pending', async () => {
    let finish!: (result: { error: null; needsConfirmation: false }) => void;
    mocks.signUp.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<MemoryRouter><AccountPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Need an account? Create one' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'trader@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    await verify();
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form')!);
    mocks.auth.loading = true;
    view.rerender(<MemoryRouter><AccountPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Creating account' })).toBeDisabled();
    expect(screen.queryByText(/Loading.*account/i)).not.toBeInTheDocument();
    await act(async () => finish({ error: null, needsConfirmation: false }));
  });
  it('returns to the sign-in form after sign-out even if the session check is pending', async () => {
    mocks.auth.user = { id: 'uid', email: 'trader@example.com' };
    mocks.signOut.mockResolvedValue({ error: null });
    const view = render(<MemoryRouter><AccountPage /></MemoryRouter>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out' })));
    mocks.auth.user = null;
    mocks.auth.loading = true;
    view.rerender(<MemoryRouter><AccountPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.queryByText(/Loading.*account/i)).not.toBeInTheDocument();
  });
  it.each(['sign-in', 'sign-up'])('allows Google %s without completing email fields', async (mode) => {
    mocks.google.mockResolvedValue({ error: null });
    render(<MemoryRouter><AccountPage /></MemoryRouter>);
    if (mode === 'sign-up') fireEvent.click(screen.getByRole('button', { name: 'Need an account? Create one' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' })));
    expect(mocks.google).toHaveBeenCalledOnce();
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Account ready|data is syncing/i)).not.toBeInTheDocument();
  });
  it('prevents duplicate requests and restores the form after a cancelled popup', async () => {
    let finish!: (result: { error: string }) => void;
    mocks.google.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<MemoryRouter><AccountPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(screen.getByRole('button', { name: 'Connecting to Google' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Need an account? Create one' })).toBeDisabled();
    await act(async () => finish({ error: 'Google sign-in was cancelled. Please try again.' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in was cancelled. Please try again.');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });
  it('does not say Signing out while registration is finishing', async () => {
    let finish!: (result: { error: null; needsConfirmation: false }) => void;
    mocks.signUp.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<MemoryRouter><AccountPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Need an account? Create one' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'trader@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    await verify();
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form')!);
    mocks.auth.user = { id: 'uid', email: 'trader@example.com' };
    view.rerender(<MemoryRouter><AccountPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled();
    expect(screen.queryByText(/Signing out/)).not.toBeInTheDocument();
    await act(async () => finish({ error: null, needsConfirmation: false }));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    mocks.auth.user = null;
    mocks.auth.error = 'Your session has ended. Please sign in again.';
    view.rerender(<MemoryRouter><AccountPage /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Your session has ended');
    expect(screen.queryByText(/Account ready|data is syncing/)).not.toBeInTheDocument();
  });
  it('restores the form when an unexpected request failure occurs', async () => {
    mocks.google.mockRejectedValue(new Error('internal error'));
    render(<MemoryRouter><AccountPage /></MemoryRouter>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' })));
    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t complete your request. Please try again.');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });

  it.each(['sign-in', 'sign-up'] as const)('gates %s, blocks form submission without a token, and requires a fresh token after failure', async mode => {
    mocks.signIn.mockResolvedValue({ error: 'Email or password is incorrect.' });
    mocks.signUp.mockResolvedValue({ error: 'An account with this email already exists.', needsConfirmation: false });
    render(<MemoryRouter><AccountPage /></MemoryRouter>);
    if (mode === 'sign-up') fireEvent.click(screen.getByRole('button', { name: 'Need an account? Create one' }));
    const label = mode === 'sign-in' ? 'Sign in' : 'Create account';
    const button = screen.getByRole('button', { name: label });
    const form = button.closest('form')!;
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'trader@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    expect(button).toBeDisabled();
    fireEvent.submit(form);
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
    await verify();
    expect(widgets.at(-1)!.action).toBe(mode === 'sign-in' ? 'password_login' : 'password_signup');
    expect(button).toBeEnabled();
    await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
    if (mode === 'sign-in') expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith('trader@example.com', 'password', 'fresh-auth-token');
    else expect(mocks.signUp).toHaveBeenCalledExactlyOnceWith('trader@example.com', 'password', '', 'fresh-auth-token');
    expect(screen.getByRole('button', { name: label })).toBeDisabled();
    expect(widgetApi.reset).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    await verify('second-token');
    expect(screen.getByRole('button', { name: label })).toBeEnabled();
  });

  it('clears verification on expiry, widget errors, and form switches, ignoring removed widget callbacks', async () => {
    render(<MemoryRouter><AccountPage /></MemoryRouter>);
    await verify();
    const oldWidget = widgets.at(-1)!;
    act(() => oldWidget['expired-callback']());
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    await verify();
    act(() => oldWidget['error-callback']());
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    await verify();
    fireEvent.click(screen.getByRole('button', { name: 'Need an account? Create one' }));
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    act(() => oldWidget.callback('old-login-token'));
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    await waitFor(() => expect(widgets.at(-1)!.action).toBe('password_signup'));
    await verify('signup-token');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  it.each(['sign-in', 'sign-up'])('keeps Google available when %s verification cannot load', mode => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    render(<MemoryRouter><AccountPage /></MemoryRouter>);
    if (mode === 'sign-up') fireEvent.click(screen.getByRole('button', { name: 'Need an account? Create one' }));
    expect(screen.getByRole('button', { name: mode === 'sign-in' ? 'Sign in' : 'Create account' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('temporarily unavailable');
  });
});
