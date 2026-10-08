import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const auth = { loading: false, user: null as { id: string } | null };
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select', 'eq', 'insert', 'update']) query[method] = vi.fn(() => query);
  query.maybeSingle = vi.fn();
  return { auth, query, from: vi.fn(() => query) };
});
vi.mock('../context/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../lib/database', () => ({ database: { from: mocks.from } }));
import { createInitialPaperFuturesAccount, usePaperFutures } from './usePaperFutures';
const row = (balance = 9500, updated_at = '2026-01-01T00:00:00.000Z') => ({ balance, realized_pnl: 0, positions: [], orders: [], trades: [], updated_at });
const orderInput = { coinId: 'bitcoin', coinName: 'Bitcoin', symbol: 'btc', side: 'long' as const, price: 100, margin: 10, leverage: 5, stopLoss: null, takeProfit: null, orderType: 'limit' as const, limitPrice: 80 };
beforeEach(() => { mocks.auth.user = { id: 'user-a' }; mocks.query.maybeSingle.mockReset().mockResolvedValue({ data: row(), error: null }); });
afterEach(() => { cleanup(); mocks.auth.user = null; vi.clearAllMocks(); localStorage.clear(); });
describe('paper futures cloud persistence', () => {
  it('loads an existing ledger without overwriting it', async () => {
    const { result } = renderHook(() => usePaperFutures());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));
    expect(result.current.account.balance).toBe(9500);
    expect(mocks.query.update).not.toHaveBeenCalled();
    expect(mocks.query.insert).not.toHaveBeenCalled();
  });
  it('keeps anonymous trades separate when signing in', async () => {
    mocks.auth.user = null;
    localStorage.setItem('blocklens_paper_futures', JSON.stringify({ ...createInitialPaperFuturesAccount(), balance: 9250 }));
    const { result, rerender } = renderHook(() => usePaperFutures());
    await waitFor(() => expect(result.current.account.balance).toBe(9250));
    act(() => { mocks.auth.user = { id: 'user-a' }; rerender(); });
    await waitFor(() => expect(result.current.account.balance).toBe(9500));
    expect(JSON.parse(localStorage.getItem('blocklens_paper_futures')!)).toMatchObject({ balance: 9250 });
    expect(mocks.query.update).not.toHaveBeenCalled();
  });
  it.each([{ data: null, error: { message: 'offline' } }, { data: row(NaN), error: null }])('blocks trades instead of replacing an unreadable ledger', async response => {
    mocks.query.maybeSingle.mockResolvedValue(response);
    const { result } = renderHook(() => usePaperFutures());
    await waitFor(() => expect(result.current.syncStatus).toBe('error'));
    expect(mocks.query.insert).not.toHaveBeenCalled();
    expect(mocks.query.update).not.toHaveBeenCalled();
  });
  it('uses the loaded revision and reloads a changed account after a conflict', async () => {
    const { result } = renderHook(() => usePaperFutures());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));
    mocks.query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    act(() => { result.current.placeOrder(orderInput); });
    await waitFor(() => expect(result.current.syncStatus).toBe('error'));
    expect(mocks.query.eq).toHaveBeenCalledWith('updated_at', '2026-01-01T00:00:00.000Z');
    expect(result.current.syncError).toContain('another tab or device');
    mocks.query.maybeSingle.mockResolvedValue({ data: row(9400, '2026-01-02T00:00:00.000Z'), error: null });
    act(() => result.current.retrySync());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));
    expect(result.current.account.balance).toBe(9400);
    expect(result.current.account.orders).toHaveLength(0);
    expect(mocks.query.update).toHaveBeenCalledTimes(1);
  });
  it('retains unsaved orders on a failed save and retries the full ledger', async () => {
    const { result } = renderHook(() => usePaperFutures());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));
    mocks.query.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    act(() => { result.current.placeOrder(orderInput); });
    await waitFor(() => expect(result.current.syncStatus).toBe('error'));
    expect(result.current.account.orders).toHaveLength(1);
    const updated_at = result.current.account.updatedAt;
    mocks.query.maybeSingle.mockResolvedValueOnce({ data: row(), error: null }).mockResolvedValueOnce({ data: { updated_at }, error: null });
    act(() => result.current.retrySync());
    await waitFor(() => expect(result.current.syncStatus).toBe('ready'));
    expect(mocks.query.update.mock.lastCall?.[0].orders).toHaveLength(1);
  });
});
