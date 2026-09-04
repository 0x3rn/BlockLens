import { describe, expect, it } from 'vitest';
import { getFuturesLiquidationPrice, getFuturesMaintenanceMargin, getFuturesReturnOnEquity, getFuturesUnrealizedPnl, shouldTriggerFuturesOrder } from './usePaperFutures';
import type { PaperFuturesPosition } from '../types/crypto';

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
});
