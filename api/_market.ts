import type { AIAnalysisRequest, ChartData, Coin, CurrencyCode } from '../src/types/crypto.ts';
import type { ServerEnvironment } from './_env.ts';

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const DEFAULT_CURRENCY: CurrencyCode = 'usd';
const MARKET_CACHE_TTL = 45_000;
const HISTORY_CACHE_TTL = 120_000;

type CacheEntry<T> = { value: T; expiresAt: number };

const marketCache = new Map<string, CacheEntry<Coin[]>>();
const historyCache = new Map<string, CacheEntry<ChartData[]>>();
const marketPending = new Map<string, Promise<Coin[]>>();
const historyPending = new Map<string, Promise<ChartData[]>>();

const getCoinGeckoHeaders = (environment: ServerEnvironment = {}): Record<string, string> => {
  const apiKey = environment.COINGECKO_API_KEY?.trim();
  return apiKey ? { Accept: 'application/json', 'x-cg-demo-api-key': apiKey } : { Accept: 'application/json' };
};

const fetchJson = async <T>(path: string, params: Record<string, string>, environment?: ServerEnvironment): Promise<T> => {
  const query = new URLSearchParams(params).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${COINGECKO_BASE_URL}${path}?${query}`, {
      headers: getCoinGeckoHeaders(environment),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`CoinGecko returned ${response.status}.`);
    }
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
};

const withCache = async <T>(
  cache: Map<string, CacheEntry<T>>,
  pending: Map<string, Promise<T>>,
  key: string,
  ttl: number,
  loader: () => Promise<T>,
): Promise<T> => {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const request = loader()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + ttl });
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
};

/**
 * Server-side counterpart to the browser market request. Keeping this in one
 * place means the Telegram bot and the website can use the same CoinGecko
 * ordering, page size, and precision rules.
 */
export const fetchTopCoins = async (
  currency: CurrencyCode = DEFAULT_CURRENCY,
  environment?: ServerEnvironment,
): Promise<Coin[]> => (
  withCache(marketCache, marketPending, `markets:${currency}`, MARKET_CACHE_TTL, () => fetchJson<Coin[]>('/coins/markets', {
    vs_currency: currency,
    order: 'market_cap_desc',
    per_page: '100',
    page: '1',
    sparkline: 'true',
    price_change_percentage: '7d,30d',
    precision: 'full',
  }, environment))
);

const fetchCoinHistory = async (
  coinId: string,
  days: number,
  currency: CurrencyCode,
  environment?: ServerEnvironment,
): Promise<ChartData[]> => withCache(historyCache, historyPending, `history:${coinId}:${days}:${currency}`, HISTORY_CACHE_TTL, async () => {
  const payload = await fetchJson<{
    prices: [number, number][];
    total_volumes?: [number, number][];
  }>(`/coins/${encodeURIComponent(coinId)}/market_chart`, {
    vs_currency: currency,
    days: String(days),
    precision: 'full',
  }, environment);

  return payload.prices
    .map(([timestamp, price], index) => ({
      timestamp,
      price,
      volume: payload.total_volumes?.[index]?.[1],
    }))
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.price));
});

const isSupportedCoinId = (coinId: string) => /^[a-z0-9-]{1,100}$/.test(coinId);

/** Build the exact payload accepted by api/analyze.ts for a selected coin. */
export const buildAnalysisRequest = async (
  coinId: string,
  currency: CurrencyCode = DEFAULT_CURRENCY,
  environment?: ServerEnvironment,
): Promise<AIAnalysisRequest> => {
  if (!isSupportedCoinId(coinId)) throw new Error('That coin identifier is not valid.');

  const coins = await fetchTopCoins(currency, environment);
  const coin = coins.find((item) => item.id === coinId);
  if (!coin) throw new Error('That coin is no longer in the current top-100 market snapshot.');

  const [chartData7d, chartData30d, chartData1y] = await Promise.all([
    fetchCoinHistory(coin.id, 7, currency, environment),
    fetchCoinHistory(coin.id, 30, currency, environment),
    fetchCoinHistory(coin.id, 365, currency, environment),
  ]);

  const dataAsOf = coin.last_updated ?? new Date().toISOString();
  return {
    coinId: coin.id,
    coinName: coin.name,
    currency,
    price: coin.current_price,
    change24h: coin.price_change_percentage_24h ?? 0,
    chartData7d,
    chartData30d,
    chartData1y,
    dataAsOf,
  };
};
