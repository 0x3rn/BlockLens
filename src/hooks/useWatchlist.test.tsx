import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
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
vi.mock('../lib/database', () => ({ database: { from: mocks.from } }));

import { useWatchlist } from './useWatchlist';

const deferredSave = () => {
  let resolve!: (value: { error: null }) => void;
  const promise = new Promise<{ error: null }>((done) => { resolve = done; });
  return { promise, resolve: () => resolve({ error: null }) };
};

describe('account watchlist persistence', () => {
  afterEach(() => {
    cleanup();
    mocks.auth.loading = false;
    mocks.auth.user = { id: '00000000-0000-4000-8000-000000000001' };
    mocks.state.selectResult = { data: [{ coin_id: 'bitcoin' }], error: null };
    mocks.state.mutationError = null;
    Object.values(mocks.query).forEach((mock) => mock.mockClear());
    mocks.from.mockClear();
    localStorage.clear();
  });

  it('hydrates the signed-in watchlist from Neon', async () => {
    const { result } = renderHook(() => useWatchlist());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));
    expect(result.current.watchlist).toEqual(['bitcoin']);
  });

  it('does not pretend a rejected Neon mutation was saved', async () => {
    mocks.state.mutationError = { message: 'permission denied' };
    const { result } = renderHook(() => useWatchlist());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));

    let mutationResult: Awaited<ReturnType<typeof result.current.toggleWatchlist>> | undefined;
    await act(async () => {
      mutationResult = await result.current.toggleWatchlist('ethereum');
    });

    expect(mutationResult).toMatchObject({ ok: false });
    expect(result.current.watchlist).toEqual(['bitcoin']);
    expect(result.current.syncError).toMatch(/could not be saved/i);
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

  it('deletes from Neon before removing a saved asset', async () => {
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

  it('keeps both additions when their saves complete in reverse order', async () => {
    const ethereum = deferredSave();
    const solana = deferredSave();
    mocks.query.upsert.mockImplementationOnce(() => ethereum.promise).mockImplementationOnce(() => solana.promise);
    const { result } = renderHook(() => useWatchlist());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));
    let first!: ReturnType<typeof result.current.toggleWatchlist>;
    let second!: ReturnType<typeof result.current.toggleWatchlist>;
    act(() => {
      first = result.current.toggleWatchlist('ethereum');
      second = result.current.toggleWatchlist('solana');
    });
    await act(async () => { solana.resolve(); await second; });
    await act(async () => { ethereum.resolve(); await first; });
    expect(result.current.watchlist).toEqual(['bitcoin', 'solana', 'ethereum']);
  });

  it('does not restore a removed asset when another pending addition finishes', async () => {
    const save = deferredSave();
    mocks.query.upsert.mockImplementationOnce(() => save.promise);
    const { result } = renderHook(() => useWatchlist());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));
    let addition!: ReturnType<typeof result.current.toggleWatchlist>;
    await act(async () => {
      addition = result.current.toggleWatchlist('ethereum');
      await result.current.toggleWatchlist('bitcoin');
    });
    await act(async () => { save.resolve(); await addition; });
    expect(result.current.watchlist).toEqual(['ethereum']);
  });

  it('shares a pending change when the same star is clicked twice', async () => {
    const save = deferredSave();
    mocks.query.upsert.mockImplementationOnce(() => save.promise);
    const { result } = renderHook(() => useWatchlist());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));
    let changes!: Promise<unknown[]>;
    act(() => {
      changes = Promise.all([result.current.toggleWatchlist('ethereum'), result.current.toggleWatchlist('ethereum')]);
    });
    expect(mocks.query.upsert).toHaveBeenCalledTimes(1);
    await act(async () => { save.resolve(); await changes; });
    expect(result.current.watchlist).toEqual(['bitcoin', 'ethereum']);
  });

  it('does not copy a save finishing after sign-out into the device watchlist', async () => {
    localStorage.setItem('blocklens_watchlist', JSON.stringify(['solana']));
    const save = deferredSave();
    mocks.query.upsert.mockImplementationOnce(() => save.promise);
    const { result, rerender } = renderHook(() => useWatchlist());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));
    let change!: ReturnType<typeof result.current.toggleWatchlist>;
    act(() => { change = result.current.toggleWatchlist('ethereum'); });
    mocks.auth.user = null;
    rerender();
    await waitFor(() => expect(result.current.watchlist).toEqual(['solana']));
    await act(async () => { save.resolve(); await change; });
    expect(result.current.watchlist).toEqual(['solana']);
    expect(JSON.parse(localStorage.getItem('blocklens_watchlist')!)).toEqual(['solana']);
  });

  it('does not treat an unresolved auth session as an anonymous save', async () => {
    mocks.auth.loading = true;
    mocks.auth.user = null;
    const { result } = renderHook(() => useWatchlist());
    await act(async () => {
      await expect(result.current.toggleWatchlist('ethereum')).resolves.toMatchObject({ ok: false });
    });
    expect(result.current.watchlist).toEqual([]);
    expect(mocks.query.upsert).not.toHaveBeenCalled();
  });
});
