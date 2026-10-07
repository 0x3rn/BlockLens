import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCoinProfileCache, fetchCoinProfile } from '../api/_coin';
import { handleCoinApi, handleCoinPage } from './coin-page';

const money = { usd: 2, eur: 1.8, gbp: 1.5, ngn: 3000 };
const fixture = {
  id: 'stellar', name: 'Stellar', symbol: 'xlm',
  image: { large: '/stellar.png', small: '/stellar.png', thumb: '/stellar.png' },
  description: { en: 'Stellar </script><script>alert(1)</script>' },
  market_data: {
    current_price: money, market_cap: money, total_volume: money, high_24h: money, low_24h: money,
    ath: money, atl: money, ath_date: {}, atl_date: {}, circulating_supply: 100,
  },
};
const shell = '<!doctype html><html><head><title>BlockLens</title><meta name="description" content="Generic"></head><body><div id="root"></div></body></html>';
const environment = { ASSETS: { fetch: vi.fn(async () => new Response(shell, { headers: { 'Content-Security-Policy': "script-src 'self'", ETag: 'original' } })) } };
const request = (method = 'GET') => new Request('https://blocklens.corstack.dev/coin/stellar?source=google', { method });

describe('Public coin page rendering', () => {
  beforeEach(() => { clearCoinProfileCache(); vi.stubGlobal('fetch', vi.fn(async () => Response.json(fixture))); });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('serves visible coin content, route-specific canonical metadata, and safely serialized browser data', async () => {
    const response = await handleCoinPage(request(), environment, 'stellar');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('<h1>Stellar');
    expect(html).toContain('Market statistics');
    expect(html).toContain('href="https://blocklens.corstack.dev/coin/stellar"');
    expect(html).toContain('<title>Stellar Price &amp; Market Data · BlockLens</title>');
    const seed = html.match(/<script id="coin-profile-data"[^>]*>(.*?)<\/script>/s)?.[1];
    expect(seed).not.toContain('<');
    expect(JSON.parse(seed!)).toMatchObject({ id: 'stellar', dataSource: 'coingecko' });
    expect(response.headers.get('Content-Security-Policy')).toBe("script-src 'self'");
    expect(response.headers.get('ETag')).toBeNull();
  });

  it('preserves HTTP semantics for HEAD', async () => {
    const response = await handleCoinPage(request('HEAD'), environment, 'stellar');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('returns a real 404 for an unknown asset', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }));
    const response = await handleCoinPage(request(), environment, 'does-not-exist');
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns retryable 503 for provider outages instead of a 200 error page', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response('', { status: 429 }));
    const response = await handleCoinPage(request(), environment, 'stellar');
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('60');
  });

  it('does not send malformed identifiers upstream', async () => {
    expect((await handleCoinPage(request(), environment, '../stellar')).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('coalesces simultaneous requests and caches only successful profiles', async () => {
    await Promise.all([fetchCoinProfile('stellar', {}), fetchCoinProfile('stellar', {})]);
    await fetchCoinProfile('stellar', {});
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the exact backup asset and quotes without inventing unavailable statistics', async () => {
    vi.mocked(fetch).mockImplementation(async input => {
      const url = String(input);
      if (url.includes('coingecko')) return new Response('', { status: 429 });
      if (url.includes('/tickers/xlm-stellar')) return Response.json({ id: 'xlm-stellar', name: 'Stellar', symbol: 'XLM', rank: 20, quotes: { USD: { price: 2, market_cap: 1000, volume_24h: 100, percent_change_24h: 1 } } });
      if (url.endsWith('/coins/xlm-stellar')) return Response.json({ id: 'xlm-stellar', description: 'The Stellar network.' });
      throw new Error('Unexpected upstream request: ' + url);
    });
    const coin = await fetchCoinProfile('stellar', {});
    expect(coin.dataSource).toBe('coinpaprika');
    expect(coin.market_data.current_price.usd).toBe(2);
    expect(coin.market_data.current_price.ngn).toBeUndefined();
    expect(coin.market_data.high_24h.usd).toBeUndefined();
    expect(coin.market_data.circulating_supply).toBeNull();
    expect(coin.market_data.price_change_percentage_1y).toBeNull();
    expect(await (await handleCoinPage(request(), environment, 'stellar')).text()).toContain('Market data by CoinPaprika');
  });

  it('shares the profile through the public API and rejects write methods', async () => {
    const url = 'https://blocklens.corstack.dev/api/market/coin?coinId=stellar';
    const response = await handleCoinApi(new Request(url), environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 'stellar' });
    expect((await handleCoinApi(new Request(url, { method: 'POST' }), environment)).status).toBe(405);
  });

  it('fails closed when the static app shell cannot be loaded', async () => {
    const broken = { ASSETS: { fetch: async () => new Response('missing shell') } };
    expect((await handleCoinPage(request(), broken, 'stellar')).status).toBe(503);
  });
});
