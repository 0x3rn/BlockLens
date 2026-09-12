import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAnalysisCandleSeries, fetchTopCoins, normalizeAnalysisSelection } from './_market';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('analysis selection boundary', () => {
  it('accepts a supported coin and currency without trusting browser market values', () => {
    expect(normalizeAnalysisSelection({ coinId: 'bitcoin', currency: 'usd', mode: 'short-term' })).toEqual({ coinId: 'bitcoin', currency: 'usd', mode: 'short-term' });
  });

  it.each([
    null,
    {},
    { coinId: 'bitcoin', currency: 'usd' },
    { coinId: '../bitcoin', currency: 'usd', mode: 'swing' },
    { coinId: 'bitcoin', currency: 'cad', mode: 'swing' },
    { coinId: 'bitcoin', currency: 'usd', mode: 'day-trade' },
    { coinId: 'bitcoin', currency: 'usd', mode: 'swing', price: 1 },
    { coinId: 'x'.repeat(101), currency: 'usd', mode: 'swing' },
  ])('rejects malformed or unsupported selections: %j', (value) => {
    expect(normalizeAnalysisSelection(value)).toBeNull();
  });
});

describe('CoinGecko resilience', () => {
  it('retries one transient upstream failure before returning market data', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'bitcoin' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const request = fetchTopCoins('eur');
    await vi.advanceTimersByTimeAsync(250);

    await expect(request).resolves.toEqual([{ id: 'bitcoin' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permanent upstream rejection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTopCoins('gbp')).rejects.toThrow('returned 400: bad request');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('exchange candle loading', () => {
  it('resolves a verified pair, loads every short-term timeframe, and excludes open candles', async () => {
    const now = Date.now();
    const klines = Array.from({ length: 51 }, (_, index) => [
      now - ((52 - index) * 60_000), '100', '102', '99', '101', '1000',
      index === 50 ? now + 60_000 : now - ((51 - index) * 60_000),
    ]);
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const url = String(input);
      if (url.includes('/tickers?')) return Promise.resolve(new Response(JSON.stringify({ tickers: [{ base: 'BTC', target: 'USDT', market: { identifier: 'binance' }, is_anomaly: false, is_stale: false }] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify(klines), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAnalysisCandleSeries('bitcoin-candle-test', 'usd', 'short-term');

    expect(result.map(({ interval }) => interval)).toEqual(['15m', '1h', '4h', '1d']);
    expect(result.every(({ symbol, candles }) => symbol === 'BTCUSDT' && candles.length === 50)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('rejects unsupported display currencies before calling a provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchAnalysisCandleSeries('bitcoin-currency-test', 'eur', 'swing')).rejects.toThrow('requires USD');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to a verified Coinbase spot pair when Binance is unavailable', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const url = new URL(String(input));
      if (url.hostname.includes('coingecko.com')) {
        const exchange = url.searchParams.get('exchange_ids');
        const ticker = exchange === 'gdax'
          ? { base: 'BTC', target: 'USD', market: { identifier: 'gdax' }, is_anomaly: false, is_stale: false }
          : { base: 'BTC', target: 'USDT', market: { identifier: 'binance' }, is_anomaly: false, is_stale: false };
        return Promise.resolve(new Response(JSON.stringify({ tickers: [ticker] }), { status: 200 }));
      }
      if (url.hostname.includes('binance')) return Promise.resolve(new Response('restricted', { status: 451 }));
      const granularity = Number(url.searchParams.get('granularity'));
      const start = Date.parse(url.searchParams.get('start')!) / 1_000;
      const rows = Array.from({ length: 300 }, (_, index) => {
        const price = 100 + (index / 100);
        return [start + (index * granularity), price - 1, price + 2, price, price + 1, 1_000 + index];
      });
      return Promise.resolve(new Response(JSON.stringify(rows), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAnalysisCandleSeries('bitcoin-fallback-test', 'usd', 'swing');

    expect(result.map(({ interval }) => interval)).toEqual(['4h', '1d', '1w']);
    expect(result.every(({ source, symbol, candles }) => source === 'coinbase-spot' && symbol === 'BTC-USD' && candles.length >= 50)).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('exchange_ids=gdax'))).toBe(true);
  });

  it('uses validated Kraken spot candles in the Cloudflare runtime', async () => {
    const now = Date.now();
    const fetchMock = vi.fn().mockImplementation((input: string | URL) => {
      const url = new URL(String(input));
      if (url.hostname.includes('coingecko.com')) {
        return Promise.resolve(new Response(JSON.stringify({ tickers: [{ base: 'BTC', target: 'USD', market: { identifier: 'kraken' }, is_anomaly: false, is_stale: false }] }), { status: 200 }));
      }
      const interval = Number(url.searchParams.get('interval')) * 60_000;
      const rows = Array.from({ length: 721 }, (_, index) => {
        const price = 100 + (index / 100);
        return [Math.floor((now - ((722 - index) * interval)) / 1_000), price, price + 2, price - 1, price + 1, price, 1_000 + index, 10];
      });
      return Promise.resolve(new Response(JSON.stringify({ error: [], result: { XXBTZUSD: rows, last: '1' } }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAnalysisCandleSeries('bitcoin-worker-test', 'usd', 'swing', { ASSETS: {} } as never);

    expect(result.map(({ interval }) => interval)).toEqual(['4h', '1d', '1w']);
    expect(result.every(({ source, symbol, candles }) => source === 'kraken-spot' && symbol === 'BTCUSD' && candles.length >= 50)).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('api.kraken.com'))).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('api.binance.com'))).toBe(false);
  });
});
