import axios, { AxiosError } from 'axios';
import {
  AIAnalysis,
  AIAnalysisRequest,
  CandleData,
  CandleInterval,
  ChartData,
  Coin,
  CoinDetail,
  CurrencyCode,
  MarketMetrics,
  TrendingCoin,
} from '../types/crypto';

const marketApi = axios.create({
  baseURL: 'https://api.coingecko.com/api/v3',
  timeout: 15_000,
  headers: { Accept: 'application/json' },
});

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const pending = new Map<string, Promise<unknown>>();

interface CoinGeckoTrendingItem {
  id: string;
  name: string;
  symbol: string;
  small: string;
  market_cap_rank?: number | null;
  score: number;
}

const cachedRequest = async <T>(
  key: string,
  ttl: number,
  loader: () => Promise<T>,
  force = false,
): Promise<T> => {
  const cached = cache.get(key) as CacheEntry<T> | undefined;
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value;

  if (!force) {
    const inFlight = pending.get(key) as Promise<T> | undefined;
    if (inFlight) return inFlight;
  }

  const request = loader()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + ttl });
      return value;
    })
    .finally(() => pending.delete(key));

  pending.set(key, request);
  return request;
};

export const fetchMarketData = async (
  currency: CurrencyCode = 'usd',
  force = false,
): Promise<Coin[]> => cachedRequest(`markets:${currency}`, 55_000, async () => {
  const response = await marketApi.get<Coin[]>('/coins/markets', {
    params: {
      vs_currency: currency,
      order: 'market_cap_desc',
      per_page: 100,
      page: 1,
      sparkline: true,
      price_change_percentage: '7d,30d',
      precision: 'full',
    },
  });
  return response.data;
}, force);

export const fetchCoinHistory = async (
  coinId: string,
  days = 7,
  currency: CurrencyCode = 'usd',
): Promise<ChartData[]> => cachedRequest(`history:${coinId}:${days}:${currency}`, 5 * 60_000, async () => {
  const response = await marketApi.get<{
    prices: [number, number][];
    market_caps: [number, number][];
    total_volumes: [number, number][];
  }>(`/coins/${encodeURIComponent(coinId)}/market_chart`, {
    params: { vs_currency: currency, days, precision: 'full' },
  });

  return response.data.prices.map(([timestamp, price], index) => ({
    timestamp,
    price,
    marketCap: response.data.market_caps[index]?.[1],
    volume: response.data.total_volumes[index]?.[1],
  }));
});

  const candleIntervalMs: Record<CandleInterval, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
    '1h': 60 * 60_000,
    '4h': 4 * 60 * 60_000,
    '12h': 12 * 60 * 60_000,
    '24h': 24 * 60 * 60_000,
  };
  const candleHistoryDays: Record<CandleInterval, number> = {
    '5m': 1,
    '15m': 1,
    '30m': 1,
    '1h': 1,
    '4h': 4,
    '12h': 12,
    '24h': 24,
  };

export const fetchCoinCandles = async (
  coinId: string,
  interval: CandleInterval,
  currency: CurrencyCode = 'usd',
): Promise<CandleData[]> => cachedRequest(`candles:${coinId}:${interval}:${currency}`, 30_000, async () => {
  const response = await marketApi.get<{
    prices: [number, number][];
    total_volumes: [number, number][];
  }>(`/coins/${encodeURIComponent(coinId)}/market_chart`, {
    params: { vs_currency: currency, days: candleHistoryDays[interval], precision: 'full' },
  });

  const bucketSize = candleIntervalMs[interval];
  const buckets = new Map<number, CandleData>();
  let previousVolume: number | null = null;
  response.data.prices.forEach(([timestamp, price], index) => {
    const volumeTotal = response.data.total_volumes[index]?.[1];
    const volume = typeof volumeTotal === 'number' && Number.isFinite(volumeTotal) && previousVolume != null
      ? Math.max(0, volumeTotal - previousVolume)
      : 0;
    if (typeof volumeTotal === 'number' && Number.isFinite(volumeTotal)) previousVolume = volumeTotal;
    if (!Number.isFinite(timestamp) || !Number.isFinite(price)) return;
    const bucket = Math.floor(timestamp / bucketSize) * bucketSize;
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, { timestamp: bucket, open: price, high: price, low: price, close: price, volume });
      return;
    }
    current.high = Math.max(current.high, price);
    current.low = Math.min(current.low, price);
    current.close = price;
    current.volume += volume;
  });

  const candles = [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);

  if (candles.length < 2) throw new Error('Intraday candles are not available for this asset.');
  return candles;
});

export const fetchMarketMetrics = async (
  currency: CurrencyCode = 'usd',
  force = false,
): Promise<MarketMetrics> => cachedRequest(`global:${currency}`, 55_000, async () => {
  const response = await marketApi.get('/global');
  const data = response.data.data;

  return {
    totalMarketCap: data.total_market_cap?.[currency] ?? 0,
    totalVolume24h: data.total_volume?.[currency] ?? 0,
    marketCapChange24h: data.market_cap_change_percentage_24h_usd ?? 0,
    bitcoinDominance: data.market_cap_percentage?.btc ?? 0,
    activeCryptocurrencies: data.active_cryptocurrencies ?? 0,
    trackedMarkets: data.markets ?? 0,
    updatedAt: (data.updated_at ?? Math.floor(Date.now() / 1000)) * 1000,
  };
}, force);

export const fetchCoinDetail = async (coinId: string): Promise<CoinDetail> => (
  cachedRequest(`detail:${coinId}`, 2 * 60_000, async () => {
    const response = await marketApi.get<CoinDetail>(`/coins/${encodeURIComponent(coinId)}`, {
      params: {
        localization: false,
        tickers: false,
        community_data: false,
        developer_data: false,
        sparkline: false,
      },
    });
    return response.data;
  })
);

export const fetchTrendingCoins = async (): Promise<TrendingCoin[]> => (
  cachedRequest('trending', 5 * 60_000, async () => {
    const response = await marketApi.get<{ coins?: { item: CoinGeckoTrendingItem }[] }>('/search/trending');
    return (response.data.coins ?? []).map(({ item }) => ({
      id: item.id,
      name: item.name,
      symbol: item.symbol,
      image: item.small,
      marketCapRank: item.market_cap_rank ?? null,
      score: item.score,
    }));
  })
);

export const requestAIAnalysis = async (payload: AIAnalysisRequest): Promise<AIAnalysis> => {
  const response = await axios.post<AIAnalysis>('/api/analyze', payload, {
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json' },
  });
  return response.data;
};

export const getApiErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ error?: string }>;
    if (axiosError.response?.status === 429) {
      return 'The market data provider is rate-limiting requests. Please wait a moment and retry.';
    }
    if (axiosError.response?.data?.error) return axiosError.response.data.error;
    if (axiosError.code === 'ECONNABORTED') return 'The request timed out. Please retry.';
    if (!axiosError.response) return 'The data service could not be reached. Check your connection and retry.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong while loading data. Please retry.';
};
