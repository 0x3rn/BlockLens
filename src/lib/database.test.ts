import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock('./firebase', () => ({ isFirebaseConfigured: true, getAccountToken: mocks.token }));
import { database } from './database';
describe('Neon account client', () => {
  afterEach(() => { vi.unstubAllGlobals(); mocks.token.mockReset(); });
  it('sends a fresh auth token to the same-origin API and executes once', async () => {
    mocks.token.mockResolvedValue('firebase-id-token');
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ coin_id: 'bitcoin' }], error: null })));
    vi.stubGlobal('fetch', request);
    const query = database!.from('watchlist_items').select('coin_id').eq('user_id', 'owner').order('created_at', { ascending: true });
    expect(await query).toMatchObject({ data: [{ coin_id: 'bitcoin' }], error: null });
    await query;
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('/api/account');
    expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer firebase-id-token');
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ table: 'watchlist_items', operation: 'select' });
  });
  it('returns mutation failures so hooks never report a rejected write as saved', async () => {
    mocks.token.mockResolvedValue('firebase-id-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: null, error: { message: 'denied' } }), { status: 403 })));
    expect(await database!.from('watchlist_items').upsert({ user_id: 'owner', coin_id: 'bitcoin' }, { onConflict: 'user_id,coin_id' })).toMatchObject({ error: { message: 'You don’t have permission to access this data.' } });
  });
  it('refreshes an expired API token once and retains the signed-in account', async () => {
    mocks.token.mockResolvedValueOnce('old-token').mockResolvedValueOnce('fresh-token');
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'JWT diagnostic' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [], error: null })));
    vi.stubGlobal('fetch', request);
    expect(await database!.from('watchlist_items').select()).toEqual({ data: [], error: null });
    expect(mocks.token).toHaveBeenLastCalledWith(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token');
  });
  it('stops after one refresh and hides server diagnostics without claiming the session expired', async () => {
    mocks.token.mockResolvedValue('valid-token');
    const request = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: { message: 'Firebase project misconfigured / internal token diagnostic' } }), { status: 401 })));
    vi.stubGlobal('fetch', request);
    const result = await database!.from('watchlist_items').select();
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.error?.message).toBe('We couldn’t load your saved data. Please try again.');
  });
  it('does not query without a session and handles unavailable APIs', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    mocks.token.mockResolvedValue(null);
    expect((await database!.from('watchlist_items').select()).error).not.toBeNull();
    expect(request).not.toHaveBeenCalled();
    mocks.token.mockResolvedValue('firebase-id-token');
    request.mockRejectedValue(new Error('offline'));
    expect((await database!.from('watchlist_items').select()).error).not.toBeNull();
  });
});
