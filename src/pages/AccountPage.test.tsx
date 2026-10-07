import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

describe('Google sign-in on the account page', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.loading = false; mocks.auth.user = null; mocks.auth.error = null; });
  afterEach(cleanup);
  it('shows the sign-in form immediately while Firebase checks for a saved session', () => {
    mocks.auth.loading = true;
    const view = render(<MemoryRouter><AccountPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
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
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
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
});
