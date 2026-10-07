import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  google: vi.fn(), signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(),
  auth: { user: null as { id: string; email: string } | null, error: null as string | null },
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({
  configured: true, loading: false, ...mocks.auth,
  signInWithGoogle: mocks.google, signIn: mocks.signIn, signUp: mocks.signUp, signOut: mocks.signOut,
}), readableAuthError: () => 'We couldn’t complete your request. Please try again.' }));
import AccountPage from './AccountPage';

describe('Google sign-in on the account page', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.user = null; mocks.auth.error = null; });
  afterEach(cleanup);
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
