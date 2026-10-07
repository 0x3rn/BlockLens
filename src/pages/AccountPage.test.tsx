import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ google: vi.fn(), signIn: vi.fn(), signUp: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({
  configured: true, loading: false, user: null, error: null,
  signInWithGoogle: mocks.google, signIn: mocks.signIn, signUp: mocks.signUp,
}) }));
import AccountPage from './AccountPage';

describe('Google sign-in on the account page', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);
  it.each(['sign-in', 'sign-up'])('allows Google %s without completing email fields', async (mode) => {
    mocks.google.mockResolvedValue({ error: null });
    render(<MemoryRouter><AccountPage /></MemoryRouter>);
    if (mode === 'sign-up') fireEvent.click(screen.getByRole('button', { name: 'Need an account? Create one' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' })));
    expect(mocks.google).toHaveBeenCalledOnce();
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Account ready. Your data is syncing.');
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
    expect(screen.getByRole('status')).toHaveTextContent('Google sign-in was cancelled. Please try again.');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });
});
