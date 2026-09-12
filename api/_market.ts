import type { AIAnalysisCandleInterval, AIAnalysisCandleSeries, AIAnalysisMode, AIAnalysisRequest, AIAnalysisSelectionRequest, CandleData, ChartData, Coin, CurrencyCode, MarketMetrics } from '../src/types/crypto.ts';
import { analysisModeDefinitions, isAIAnalysisMode } from '../src/config/analysisModes.ts';
import type { ServerEnvironment } from './_env.ts';

const COINGECKO_DEMO_BASE_URL = 'https://api.coingecko.com/api/v3';
const COINGECKO_PRO_BASE_URL = 'https://pro-api.coingecko.com/api/v3';
const DEFAULT_CURRENCY: CurrencyCode = 'usd';
const supportedCurrencies = new Set<CurrencyCode>(['usd', 'eur', 'gbp', 'ngn']);
const MARKET_CACHE_TTL = 45_000;
const HISTORY_CACHE_TTL = 120_000;
const METRICS_CACHE_TTL = 45_000;
const COINGECKO_RETRY_DELAY_MS = 250;
const CANDLE_CACHE_TTL = 60_000;
const BINANCE_MARKET_ENDPOINTS = [
  'https://data-api.binance.vision/api/v3/klines',
  'https://api.binance.com/api/v3/klines',
];

type CacheEntry<T> = { value: T; expiresAt: number };

const marketCache = new Map<string, CacheEntry<Coin[]>>();
const historyCache = new Map<string, CacheEntry<ChartData[]>>();
const metricsCache = new Map<string, CacheEntry<MarketMetrics>>();
const marketPending = new Map<string, Promise<Coin[]>>();
const historyPending = new Map<string, Promise<ChartData[]>>();
const metricsPending = new Map<string, Promise<MarketMetrics>>();
const candleCache = new Map<string, CacheEntry<AIAnalysisCandleSeries>>();
const candlePending = new Map<string, Promise<AIAnalysisCandleSeries>>();

export class AnalysisMarketDataError extends Error {
  constructor(public readonly status: 400 | 422 | 502, message: string) {
    super(message);
    this.name = 'AnalysisMarketDataError';
  }
}

type CoinGeckoRequestConfig = {
  baseUrl: string;
  headers: Record<string, string>;
  plan: 'keyless' | 'demo' | 'pro';
};

const getCoinGeckoConfig = (environment: ServerEnvironment = {}): CoinGeckoRequestConfig => {
  const apiKey = environment.COINGECKO_API_KEY?.trim();
  if (!apiKey) {
    return {
      baseUrl: COINGECKO_DEMO_BASE_URL,
      headers: { Accept: 'application/json' },
      plan: 'keyless',
    };
  }

  const plan = environment.COINGECKO_API_PLAN?.trim().toLowerCase() === 'pro' ? 'pro' : 'demo';
  return plan === 'pro'
    ? {
      baseUrl: COINGECKO_PRO_BASE_URL,
      headers: { Accept: 'application/json', 'x-cg-pro-api-key': apiKey },
      plan,
    }
    : {
      baseUrl: COINGECKO_DEMO_BASE_URL,
      headers: { Accept: 'application/json', 'x-cg-demo-api-key': apiKey },
      plan,
    };
};

const fetchJson = async <T>(path: string, params: Record<string, string>, environment?: ServerEnvironment): Promise<T> => {
  const query = new URLSearchParams(params).toString();
  const config = getCoinGeckoConfig(environment);
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let shouldRetry = true;
    try {
      let response = await fetch(`${config.baseUrl}${path}?${query}`, {
        headers: config.headers,
        signal: controller.signal,
      });
      let usedKeylessFallback = false;

      // A rejected key should not take down the bot or server-side analysis.
      if (!response.ok && config.plan !== 'keyless' && (response.status === 401 || response.status === 403)) {
        await response.text().catch(() => undefined);
        response = await fetch(`${COINGECKO_DEMO_BASE_URL}${path}?${query}`, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        usedKeylessFallback = true;
      }

      if (response.ok) return await response.json() as T;

      // Keep enough of CoinGecko's response to make deployment errors
      // actionable, while avoiding a full upstream payload in Worker logs.
      const detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 240);
      const suffix = detail ? `: ${detail}` : '.';
      const mode = usedKeylessFallback ? `${config.plan} request and keyless fallback` : `${config.plan} request`;
      lastError = new Error(`CoinGecko ${mode} returned ${response.status}${suffix}`);
      shouldRetry = response.status === 429 || response.status >= 500;
      if (!shouldRetry) throw lastError;
    } catch (error) {
      lastError = error;
      if (!shouldRetry || attempt === 1) throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, COINGECKO_RETRY_DELAY_MS));
  }

  throw lastError instanceof Error ? lastError : new Error('CoinGecko request failed.');
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

export const fetchGlobalMarketMetrics = async (
  currency: CurrencyCode = DEFAULT_CURRENCY,
  environment?: ServerEnvironment,
): Promise<MarketMetrics> => withCache(
  metricsCache,
  metricsPending,
  `metrics:${currency}`,
  METRICS_CACHE_TTL,
  async () => {
    const payload = await fetchJson<{
      data?: {
        total_market_cap?: Partial<Record<CurrencyCode, number>>;
        total_volume?: Partial<Record<CurrencyCode, number>>;
        market_cap_change_percentage_24h_usd?: number;
        market_cap_percentage?: { btc?: number };
        active_cryptocurrencies?: number;
        markets?: number;
        updated_at?: number;
      };
    }>('/global', {}, environment);
    const data = payload.data;
    if (!data) throw new Error('CoinGecko returned incomplete global market metrics.');
    return {
      totalMarketCap: data.total_market_cap?.[currency] ?? 0,
      totalVolume24h: data.total_volume?.[currency] ?? 0,
      marketCapChange24h: data.market_cap_change_percentage_24h_usd ?? 0,
      bitcoinDominance: data.market_cap_percentage?.btc ?? 0,
      activeCryptocurrencies: data.active_cryptocurrencies ?? 0,
      trackedMarkets: data.markets ?? 0,
      updatedAt: (data.updated_at ?? Math.floor(Date.now() / 1_000)) * 1_000,
    };
  },
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

const fetchBinancePair = async (coinId: string, environment?: ServerEnvironment): Promise<string> => {
  const payload = await fetchJson<{
    tickers?: Array<{ base?: string; target?: string; market?: { identifier?: string }; is_anomaly?: boolean; is_stale?: boolean }>;
  }>(`/coins/${encodeURIComponent(coinId)}/tickers`, {
    exchange_ids: 'binance',
    include_exchange_logo: 'false',
    page: '1',
    order: 'volume_desc',
    depth: 'false',
  }, environment);
  const ticker = payload.tickers?.find((item) => (
    item.market?.identifier === 'binance'
    && item.target?.toUpperCase() === 'USDT'
    && item.is_anomaly !== true
    && item.is_stale !== true
    && typeof item.base === 'string'
    && /^[A-Z0-9]{1,20}$/i.test(item.base)
  ));
  if (!ticker?.base) throw new AnalysisMarketDataError(422, 'This asset does not have a verified Binance Spot USDT market for candle analysis.');
  return `${ticker.base.toUpperCase()}USDT`;
};

const parseBinanceCandles = (payload: unknown): CandleData[] => {
  if (!Array.isArray(payload)) return [];
  const now = Date.now();
  return payload.flatMap((row): CandleData[] => {
    if (!Array.isArray(row) || row.length < 7) return [];
    const timestamp = Number(row[0]);
    const closeTime = Number(row[6]);
    const values = row.slice(1, 6).map(Number);
    if (!Number.isFinite(timestamp) || !Number.isFinite(closeTime) || closeTime > now || values.some((value) => !Number.isFinite(value))) return [];
    const [open, high, low, close, volume] = values;
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0 || high < low) return [];
    return [{ timestamp, open, high, low, close, volume }];
  }).sort((a, b) => a.timestamp - b.timestamp);
};

const fetchBinanceCandleSeries = async (
  symbol: string,
  interval: AIAnalysisCandleInterval,
  limit: number,
): Promise<AIAnalysisCandleSeries> => withCache(
  candleCache,
  candlePending,
  `${symbol}:${interval}:${limit}`,
  CANDLE_CACHE_TTL,
  async () => {
    let lastError: unknown;
    for (const endpoint of BINANCE_MARKET_ENDPOINTS) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        const url = new URL(endpoint);
        url.search = new URLSearchParams({ symbol, interval, limit: String(limit) }).toString();
        const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
        if (!response.ok) {
          const detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 160);
          throw new Error(`Binance returned ${response.status}${detail ? `: ${detail}` : ''}`);
        }
        const candles = parseBinanceCandles(await response.json());
        if (candles.length < 50) throw new Error(`Binance returned only ${candles.length} closed ${interval} candles.`);
        return { interval, source: 'binance-spot', symbol, candles };
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Binance candle data is unavailable.');
  },
);

export const fetchAnalysisCandleSeries = async (
  coinId: string,
  currency: CurrencyCode,
  mode: AIAnalysisMode,
  environment?: ServerEnvironment,
): Promise<AIAnalysisCandleSeries[]> => {
  if (currency !== 'usd') throw new AnalysisMarketDataError(400, 'Multi-timeframe exchange analysis currently requires USD. Switch the display currency to USD and retry.');
  const symbol = await fetchBinancePair(coinId, environment);
  const definitions = analysisModeDefinitions[mode].intervals;
  const results = await Promise.allSettled(definitions.map(({ interval, limit }) => fetchBinanceCandleSeries(symbol, interval, limit)));
  const series = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  if (series.length !== definitions.length) {
    throw new AnalysisMarketDataError(502, `Complete ${analysisModeDefinitions[mode].label.toLowerCase()} exchange candle coverage is temporarily unavailable.`);
  }
  return series;
};

const isSupportedCoinId = (coinId: string) => /^[a-z0-9-]{1,100}$/.test(coinId);

export const normalizeAnalysisSelection = (value: unknown): AIAnalysisSelectionRequest | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.length !== 3 || !keys.every((key) => key === 'coinId' || key === 'currency' || key === 'mode')) return null;
  if (typeof candidate.coinId !== 'string' || !isSupportedCoinId(candidate.coinId)) return null;
  if (!supportedCurrencies.has(candidate.currency as CurrencyCode)) return null;
  if (!isAIAnalysisMode(candidate.mode)) return null;
  return { coinId: candidate.coinId, currency: candidate.currency as CurrencyCode, mode: candidate.mode };
};

/** Build the exact payload accepted by api/analyze.ts for a selected coin. */
export const buildAnalysisRequest = async (
  coinId: string,
  currency: CurrencyCode = DEFAULT_CURRENCY,
  environment?: ServerEnvironment,
  mode: AIAnalysisMode = 'swing',
): Promise<AIAnalysisRequest> => {
  if (!isSupportedCoinId(coinId)) throw new Error('That coin identifier is not valid.');

  const coins = await fetchTopCoins(currency, environment);
  const coin = coins.find((item) => item.id === coinId);
  if (!coin) throw new Error('That coin is no longer in the current top-100 market snapshot.');

  const [chartData7d, chartData30d, chartData1y, candleSeries] = await Promise.all([
    fetchCoinHistory(coin.id, 7, currency, environment),
    fetchCoinHistory(coin.id, 30, currency, environment),
    fetchCoinHistory(coin.id, 365, currency, environment),
    fetchAnalysisCandleSeries(coin.id, currency, mode, environment),
  ]);

  const dataAsOf = coin.last_updated ?? new Date().toISOString();
  return {
    coinId: coin.id,
    coinName: coin.name,
    currency,
    price: coin.current_price,
    change24h: coin.price_change_percentage_24h ?? 0,
    mode,
    candleSeries,
    chartData7d,
    chartData30d,
    chartData1y,
    dataAsOf,
  };
};
