import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTopCoins, normalizeAnalysisSelection } from './_market';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('analysis selection boundary', () => {
  it('accepts a supported coin and currency without trusting browser market values', () => {
    expect(normalizeAnalysisSelection({ coinId: 'bitcoin', currency: 'usd' })).toEqual({ coinId: 'bitcoin', currency: 'usd' });
  });

  it.each([
    null,
    {},
    { coinId: '../bitcoin', currency: 'usd' },
    { coinId: 'bitcoin', currency: 'cad' },
    { coinId: 'bitcoin', currency: 'usd', price: 1 },
    { coinId: 'x'.repeat(101), currency: 'usd' },
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
