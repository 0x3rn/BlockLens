import { describe, expect, it } from 'vitest';
import { computeCandleFeatures, normalizeAIAnalysisRequest } from './_analysis';
import type { AIAnalysisCandleInterval, AIAnalysisCandleSeries } from '../src/types/crypto';

const candles = (count = 60) => Array.from({ length: count }, (_, index) => ({
  timestamp: 1_700_000_000_000 + (index * 60_000),
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: 101 + index,
  volume: 1_000 + index,
}));

const series = (interval: AIAnalysisCandleInterval): AIAnalysisCandleSeries => ({
  interval,
  source: 'binance-spot',
  symbol: 'BTCUSDT',
  candles: candles(),
});

const validRequest = {
  coinId: 'bitcoin', coinName: 'Bitcoin', currency: 'usd', price: 119, change24h: 2,
  mode: 'swing',
  candleSeries: [series('4h'), series('1d'), series('1w')],
  chartData7d: [{ timestamp: 1, price: 100 }, { timestamp: 2, price: 110 }],
  chartData30d: [{ timestamp: 1, price: 90 }, { timestamp: 2, price: 110 }],
  chartData1y: [{ timestamp: 1, price: 50 }, { timestamp: 2, price: 110 }],
  dataAsOf: '2026-09-12T00:00:00.000Z',
};

describe('multi-timeframe analysis contract', () => {
  it('accepts complete, ordered, mode-specific closed candle series', () => {
    expect(normalizeAIAnalysisRequest(validRequest)).toMatchObject({ mode: 'swing' });
  });

  it('rejects missing timeframes, duplicate timestamps, and invalid OHLC bounds', () => {
    expect(normalizeAIAnalysisRequest({ ...validRequest, candleSeries: validRequest.candleSeries.slice(0, 2) })).toBeNull();
    const duplicate = series('4h');
    duplicate.candles[1].timestamp = duplicate.candles[0].timestamp;
    expect(normalizeAIAnalysisRequest({ ...validRequest, candleSeries: [duplicate, series('1d'), series('1w')] })).toBeNull();
    const invalidOhlc = series('1d');
    invalidOhlc.candles[5].high = invalidOhlc.candles[5].close - 1;
    expect(normalizeAIAnalysisRequest({ ...validRequest, candleSeries: [series('4h'), invalidOhlc, series('1w')] })).toBeNull();
  });
});

describe('deterministic candle features', () => {
  it('computes trend, momentum, volatility, range, and relative volume from closed candles', () => {
    const result = computeCandleFeatures(series('4h'));
    expect(result).toMatchObject({ interval: '4h', candleCount: 60, lastClose: 160, rangeLow: 139, rangeHigh: 161, rsi14: 100, trend: 'bullish' });
    expect(result.atr14).toBe(3);
    expect(result.atrPercent).toBe(1.875);
    expect(result.relativeVolume20).toBeGreaterThan(1);
  });

  it('fails explicitly when indicator history is insufficient', () => {
    expect(() => computeCandleFeatures({ ...series('15m'), candles: candles(49) })).toThrow('Insufficient closed 15m candles');
  });

  it('uses EMA20 without inventing EMA50 when completed monthly history is shorter', () => {
    const result = computeCandleFeatures({ ...series('1M'), candles: candles(20) });
    expect(result.ema20).toBeGreaterThan(0);
    expect(result.ema50).toBeNull();
  });
});
