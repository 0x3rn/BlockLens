import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../lib/database', () => ({ database: null }));
import { createInitialPaperFuturesAccount, FUTURES_FUNDING_INTERVAL_MS, getFuturesReservedBalance, usePaperFutures } from './usePaperFutures';
const input = { coinId: 'bitcoin', coinName: 'Bitcoin', symbol: 'btc', side: 'long' as const, price: 100, margin: 10, leverage: 5, stopLoss: null, takeProfit: null };
const setup = async () => {
  const hook = renderHook(() => usePaperFutures());
  await waitFor(() => expect(hook.result.current.syncStatus).toBe('ready'));
  return hook.result;
};
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });
describe('paper order lifecycle', () => {
  it.each(['long', 'short'] as const)('updates %s limits against the mark, keeps the ledger unchanged, and persists them', async side => {
    const result = await setup();
    act(() => { result.current.openPosition({ ...input, side }); });
    const before = result.current.account;
    const mark = side === 'long' ? 110 : 90;
    const stop = side === 'long' ? 105 : 95;
    const target = side === 'long' ? 120 : 80;
    let response;
    act(() => { response = result.current.updatePositionProtection(before.positions[0].id, mark, stop, target); });
    expect(response).toMatchObject({ ok: true });
    expect(result.current.account.positions[0]).toEqual({ ...before.positions[0], stopLoss: stop, takeProfit: target });
    expect(result.current.account.balance).toBe(before.balance);
    expect(result.current.account.trades).toEqual(before.trades);
    expect(result.current.account.realizedPnl).toBe(before.realizedPnl);
    cleanup();
    const reloaded = await setup();
    expect(reloaded.current.account.positions[0]).toMatchObject({ stopLoss: stop, takeProfit: target });
    act(() => { reloaded.current.updatePositionProtection(before.positions[0].id, mark, null, null); });
    expect(reloaded.current.account.positions[0]).toMatchObject({ stopLoss: null, takeProfit: null });
  });
  it.each([
    ['long', 95, 110, 94, 'stop-loss'], ['long', 95, 110, 111, 'take-profit'],
    ['short', 105, 90, 106, 'stop-loss'], ['short', 105, 90, 89, 'take-profit'],
  ] as const)('triggers edited %s protection at %s / %s', async (side, stop, target, mark, action) => {
    const result = await setup();
    act(() => { result.current.openPosition({ ...input, side, leverage: 2 }); });
    const id = result.current.account.positions[0].id;
    act(() => { result.current.updatePositionProtection(id, 100, stop, target); });
    act(() => { result.current.checkPosition(id, mark); });
    expect(result.current.account.positions).toHaveLength(0);
    expect(result.current.account.trades[0].action).toBe(action);
  });
  it.each([
    ['long', 100, 100, null], ['long', 100, null, 100],
    ['short', 100, 99, null], ['short', 100, null, 101],
    ['long', 100, NaN, null], ['long', 100, null, Infinity],
    ['long', 0, 90, 110], ['long', NaN, null, null], ['long', 100, -1, null],
  ] as const)('rejects invalid active protection %s %s %s %s', async (side, mark, stop, target) => {
    const result = await setup();
    act(() => { result.current.openPosition({ ...input, side }); });
    const before = result.current.account;
    let response;
    act(() => { response = result.current.updatePositionProtection(before.positions[0].id, mark, stop, target); });
    expect(response).toMatchObject({ ok: false });
    expect(result.current.account).toBe(before);
  });
  it('cannot update a position after it is closed', async () => {
    const result = await setup();
    act(() => { result.current.openPosition(input); });
    const id = result.current.account.positions[0].id;
    act(() => { result.current.closePosition(id, 100); });
    let response;
    act(() => { response = result.current.updatePositionProtection(id, 100, 90, 110); });
    expect(response).toMatchObject({ ok: false, message: 'That position is no longer open.' });
  });
  it.each(['long', 'short'] as const)('validates %s protection against limit entry, not mark price', async side => {
    const result = await setup();
    let response;
    act(() => { response = result.current.placeOrder({ ...input, side, orderType: 'limit', limitPrice: side === 'long' ? 80 : 120, stopLoss: side === 'long' ? 90 : 110 }); });
    expect(response).toMatchObject({ ok: false, message: expect.stringContaining('entry price') });
    expect(result.current.account.balance).toBe(10_000);
    expect(result.current.account.orders).toHaveLength(0);
  });
  it('keeps pending margin and fees in equity and refunds both on cancellation', async () => {
    const result = await setup();
    act(() => { result.current.placeOrder({ ...input, orderType: 'limit', limitPrice: 80 }); });
    expect(result.current.account.balance).toBeCloseTo(9989.98);
    expect(result.current.account.balance + getFuturesReservedBalance(result.current.account.orders)).toBeCloseTo(10_000);
    act(() => { result.current.cancelOrder(result.current.account.orders[0].id); });
    expect(result.current.account.balance).toBe(10_000);
  });
  it('fills a fully funded order when all available cash is reserved', async () => {
    const result = await setup();
    const margin = 10_000 / 1.002;
    act(() => { result.current.placeOrder({ ...input, margin, orderType: 'limit', limitPrice: 80 }); });
    act(() => { result.current.checkOrders('bitcoin', 80); });
    expect(result.current.account.orders[0].status).toBe('filled');
    expect(result.current.account.positions[0].quantity).toBeCloseTo(margin * 5 / 80);
    expect(result.current.account.balance).toBeCloseTo(0);
  });
  it('clamps dependent reductions after a partial close and cancels them after full close', async () => {
    const result = await setup();
    act(() => { result.current.openPosition(input); });
    const position = result.current.account.positions[0];
    act(() => { result.current.placeOrder({ ...input, side: 'short', orderType: 'limit', limitPrice: 150, reduceOnly: true, positionId: position.id, quantity: position.quantity }); });
    let response;
    act(() => { response = result.current.closePosition(position.id, 100, 'close', position.quantity / 4); });
    expect(response).toMatchObject({ message: 'BTC position reduced.' });
    expect(result.current.account.orders[0].quantity).toBeCloseTo(position.quantity * .75);
    act(() => { result.current.closePosition(position.id, 100); });
    expect(result.current.account.positions).toHaveLength(0);
    expect(result.current.account.orders[0].status).toBe('cancelled');
    expect(result.current.account.balance).toBeCloseTo(9999.96);
  });
  it.each([NaN, 0, -1, .6])('rejects invalid reduce-only quantity %s', async quantity => {
    const result = await setup();
    act(() => { result.current.openPosition(input); });
    let response;
    act(() => { response = result.current.placeOrder({ ...input, side: 'short', orderType: 'limit', limitPrice: 150, reduceOnly: true, positionId: result.current.account.positions[0].id, quantity }); });
    expect(response).toMatchObject({ ok: false });
    expect(result.current.account.orders).toHaveLength(0);
  });
  it('does not discard an older open order while rotating order history', async () => {
    const result = await setup();
    act(() => { result.current.placeOrder({ ...input, orderType: 'limit', limitPrice: 80 }); });
    const retained = result.current.account.orders[0].id;
    for (let i = 0; i < 205; i++) {
      act(() => { result.current.placeOrder({ ...input, coinId: 'ethereum', orderType: 'limit', limitPrice: 80 }); });
      act(() => { result.current.cancelOrder(result.current.account.orders[0].id); });
    }
    expect(result.current.account.orders.find(order => order.id === retained)?.status).toBe('open');
    expect(result.current.account.balance + getFuturesReservedBalance(result.current.account.orders)).toBeCloseTo(10_000);
  });
  it.each(['isolated', 'cross'] as const)('settles %s losses using its available collateral', async marginMode => {
    const result = await setup();
    act(() => { result.current.openPosition({ ...input, marginMode }); });
    act(() => { result.current.closePosition(result.current.account.positions[0].id, 1); });
    expect(result.current.account.balance).toBeCloseTo(marginMode === 'cross' ? 9950.4798 : 9989.9798);
  });
  it('charges funding once and debits margin when cash is exhausted', async () => {
    const account = createInitialPaperFuturesAccount();
    const openedAt = new Date(Date.now() - FUTURES_FUNDING_INTERVAL_MS).toISOString();
    account.balance = 0;
    account.positions = [{ ...input, id: 'funding-position', quantity: .5, entryPrice: 100, openedAt, lastFundingAt: openedAt, marginMode: 'isolated' }];
    localStorage.setItem('blocklens_paper_futures', JSON.stringify(account));
    const result = await setup();
    act(() => { result.current.checkPosition('funding-position', 100); });
    expect(result.current.account.positions[0].margin).toBeCloseTo(9.995);
    expect(result.current.account.realizedPnl).toBeCloseTo(-.005);
    act(() => { result.current.checkPosition('funding-position', 100); });
    expect(result.current.account.trades).toHaveLength(1);
  });
  it('does not record unpaid fees or a negative balance after collateral is exhausted', async () => {
    const result = await setup();
    const margin = 10_000 / 1.002;
    act(() => { result.current.openPosition({ ...input, margin }); });
    act(() => { result.current.closePosition(result.current.account.positions[0].id, 1, 'liquidated'); });
    expect(result.current.account.balance).toBeCloseTo(0);
    expect(result.current.account.realizedPnl).toBeCloseTo(-10_000);
    expect(result.current.account.trades[0].fee).toBeCloseTo(0);
  });
});
