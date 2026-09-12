import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const auth = { loading: false, user: { id: '00000000-0000-4000-8000-000000000001' } as { id: string } | null };
  const state = {
    selectResult: { data: [{ coin_id: 'bitcoin' }], error: null as { message: string } | null },
    mutationError: null as { message: string } | null,
  };
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.order = vi.fn(() => Promise.resolve(state.selectResult));
  query.delete = vi.fn(() => query);
  query.upsert = vi.fn(() => Promise.resolve({ error: state.mutationError }));
  return { auth, state, query, from: vi.fn(() => query) };
});

vi.mock('../context/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../lib/supabase', () => ({ supabase: { from: mocks.from } }));

import { useWatchlist } from './useWatchlist';

describe('account watchlist persistence', () => {
  afterEach(() => {
    mocks.auth.loading = false;
    mocks.auth.user = { id: '00000000-0000-4000-8000-000000000001' };
    mocks.state.selectResult = { data: [{ coin_id: 'bitcoin' }], error: null };
    mocks.state.mutationError = null;
    Object.values(mocks.query).forEach((mock) => mock.mockClear());
    mocks.from.mockClear();
    localStorage.clear();
  });

  it('hydrates the signed-in watchlist from Supabase', async () => {
    const { result } = renderHook(() => useWatchlist());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));
    expect(result.current.watchlist).toEqual(['bitcoin']);
  });

  it('does not pretend a rejected Supabase mutation was saved', async () => {
    mocks.state.mutationError = { message: 'permission denied' };
    const { result } = renderHook(() => useWatchlist());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));

    let mutationResult: Awaited<ReturnType<typeof result.current.toggleWatchlist>> | undefined;
    await act(async () => {
      mutationResult = await result.current.toggleWatchlist('ethereum');
    });

    expect(mutationResult).toMatchObject({ ok: false });
    expect(result.current.watchlist).toEqual(['bitcoin']);
    expect(result.current.syncError).toMatch(/not saved/i);
  });

  it('persists a successful change before updating signed-in state', async () => {
    const { result } = renderHook(() => useWatchlist());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));

    await act(async () => {
      await expect(result.current.toggleWatchlist('ethereum')).resolves.toEqual({ ok: true, action: 'added' });
    });

    expect(mocks.query.upsert).toHaveBeenCalledWith(
      { user_id: mocks.auth.user?.id, coin_id: 'ethereum' },
      { onConflict: 'user_id,coin_id' },
    );
    expect(result.current.watchlist).toEqual(['bitcoin', 'ethereum']);
  });

  it('deletes from Supabase before removing a saved asset', async () => {
    const { result } = renderHook(() => useWatchlist());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));

    await act(async () => {
      await expect(result.current.toggleWatchlist('bitcoin')).resolves.toEqual({ ok: true, action: 'removed' });
    });

    expect(mocks.query.delete).toHaveBeenCalledTimes(1);
    expect(result.current.watchlist).toEqual([]);
  });

  it('surfaces a failed initial load and can retry it', async () => {
    mocks.state.selectResult = { data: [], error: { message: 'network unavailable' } };
    const { result } = renderHook(() => useWatchlist());
    await waitFor(() => expect(result.current.syncStatus).toBe('error'));
    expect(result.current.syncError).toMatch(/could not be loaded/i);

    mocks.state.selectResult = { data: [{ coin_id: 'ethereum' }], error: null };
    act(() => result.current.retryWatchlistSync());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));
    expect(result.current.watchlist).toEqual(['ethereum']);
  });
});
