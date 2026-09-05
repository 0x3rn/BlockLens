import { describe, expect, it } from 'vitest';
import { createInitialPaperFuturesAccount, getFuturesLiquidationPrice, getFuturesMaintenanceMargin, getFuturesReturnOnEquity, getFuturesUnrealizedPnl, getMissingOpenOrderCoinIds, getOpenOrderMarketChecks, shouldReusePaperFuturesAccountOnRetry, shouldTriggerFuturesOrder } from './usePaperFutures';
import type { PaperFuturesOrder, PaperFuturesPosition } from '../types/crypto';
import { resolveFuturesMarkPrice } from './useFuturesMarketPrice';

const position = (side: 'long' | 'short'): PaperFuturesPosition => ({
  id: 'position-1',
  coinId: 'bitcoin',
  coinName: 'Bitcoin',
  symbol: 'btc',
  side,
  quantity: 0.1,
  entryPrice: 100,
  margin: 20,
  leverage: 5,
  stopLoss: null,
  takeProfit: null,
  openedAt: '2026-09-01T00:00:00.000Z',
});

describe('paper futures calculations', () => {
  it('calculates directional unrealized P&L', () => {
    expect(getFuturesUnrealizedPnl(position('long'), 110)).toBeCloseTo(1);
    expect(getFuturesUnrealizedPnl(position('short'), 90)).toBeCloseTo(1);
    expect(getFuturesUnrealizedPnl(position('long'), 90)).toBeCloseTo(-1);
  });

  it('keeps liquidation levels on the loss side of the entry', () => {
    expect(getFuturesLiquidationPrice(position('long'))).toBeCloseTo(80.5);
    expect(getFuturesLiquidationPrice(position('short'))).toBeCloseTo(119.5);
  });

  it('reports margin requirements and return on equity', () => {
    expect(getFuturesMaintenanceMargin(position('long'), 110)).toBeCloseTo(0.055);
    expect(getFuturesReturnOnEquity(position('long'), 110)).toBeCloseTo(5);
    expect(getFuturesReturnOnEquity(position('short'), 110)).toBeCloseTo(-5);
  });

  it('triggers limit entries on a retrace and stop entries on a breakout', () => {
    const limitLong = { type: 'limit' as const, side: 'long' as const, limitPrice: 95, triggerPrice: null };
    const stopShort = { type: 'stop-market' as const, side: 'short' as const, limitPrice: null, triggerPrice: 105 };
    expect(shouldTriggerFuturesOrder(limitLong, 95)).toBe(true);
    expect(shouldTriggerFuturesOrder(limitLong, 97)).toBe(false);
    expect(shouldTriggerFuturesOrder(stopShort, 105)).toBe(true);
    expect(shouldTriggerFuturesOrder(stopShort, 107)).toBe(false);
  });

  it('collects one market check for every asset with an open order', () => {
    const order = (id: string, coinId: string, status: PaperFuturesOrder['status']): PaperFuturesOrder => ({
      id,
      coinId,
      coinName: coinId,
      symbol: coinId,
      type: 'limit',
      side: 'long',
      status,
      margin: 10,
      leverage: 2,
      marginMode: 'isolated',
      reduceOnly: false,
      quantity: null,
      positionId: null,
      limitPrice: 100,
      triggerPrice: null,
      stopLoss: null,
      takeProfit: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      filledAt: null,
      cancelledAt: null,
    });
    const checks = getOpenOrderMarketChecks(
      [order('1', 'bitcoin', 'open'), order('2', 'ethereum', 'open'), order('3', 'bitcoin', 'open'), order('4', 'solana', 'filled')],
      new Map([['bitcoin', 101], ['ethereum', 202], ['solana', 303]]),
    );
    expect(checks).toEqual([
      { coinId: 'bitcoin', markPrice: 101 },
      { coinId: 'ethereum', markPrice: 202 },
    ]);
    expect(getMissingOpenOrderCoinIds(
      [order('1', 'bitcoin', 'open'), order('2', 'outside-top-100', 'open')],
      new Set(['bitcoin']),
    )).toEqual(['outside-top-100']);
  });

  it('reuses retry state only for the same signed-in account', () => {
    const meaningful = { ...createInitialPaperFuturesAccount(), balance: 9_000 };
    expect(shouldReusePaperFuturesAccountOnRetry(1, 'user-a', 'user-a', meaningful)).toBe(true);
    expect(shouldReusePaperFuturesAccountOnRetry(1, null, 'user-b', meaningful)).toBe(false);
    expect(shouldReusePaperFuturesAccountOnRetry(1, 'user-a', 'user-b', meaningful)).toBe(false);
  });

  it('does not associate a previous asset feed price with a newly selected coin', () => {
    expect(resolveFuturesMarkPrice({ id: 'ethereum', current_price: 3_000 }, 'bitcoin', 60_000)).toBe(3_000);
    expect(resolveFuturesMarkPrice({ id: 'ethereum', current_price: 3_000 }, 'ethereum', 3_050)).toBe(3_050);
  });
});
