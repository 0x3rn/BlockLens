import { describe, expect, it } from 'vitest';
import { getFuturesLiquidationPrice, getFuturesUnrealizedPnl } from './usePaperFutures';
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
});
