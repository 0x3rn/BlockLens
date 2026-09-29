import axios, { AxiosError } from 'axios';
import {
  AIAnalysis,
  AIAnalysisRequest,
  AIAnalysisSelectionRequest,
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

const binanceApi = axios.create({
  timeout: 8_000,
  headers: { Accept: 'application/json' },
});

const pause = (milliseconds: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, milliseconds);
});

const isRetryableMarketError = (error: unknown) => {
  if (!axios.isAxiosError(error)) return true;
  const status = error.response?.status;
  return !status || status === 408 || status === 425 || status === 429 || status >= 500;
};

const requestWithRetry = async <T>(loader: () => Promise<T>, attempts = 3): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await loader();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isRetryableMarketError(error)) throw error;
      await pause(650 * (attempt + 1));
    }
  }
  throw lastError;
};

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export type MarketSnapshot = {
  coins: Coin[];
  metrics: MarketMetrics | null;
  warning: string | null;
  source: 'coingecko' | 'coinpaprika';
  asOf: string;
};

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

interface CoinPaprikaQuote {
  price?: number;
  volume_24h?: number;
  market_cap?: number;
  percent_change_24h?: number;
  percent_change_7d?: number;
  percent_change_30d?: number;
}

interface CoinPaprikaTicker {
  id?: string;
  name?: string;
  symbol?: string;
  rank?: number;
  last_updated?: string;
  quotes?: Record<string, CoinPaprikaQuote | undefined>;
}

const coinGeckoIdByPaprikaId: Record<string, string> = {
  'bnb-binance-coin': 'binancecoin',
  'xrp-xrp': 'ripple',
  'steth-lido-staked-ether': 'staked-ether',
  'wsteth-wrapped-liquid-staked-ether-20': 'wrapped-steth',
  'usdc-usd-coin': 'usd-coin',
  'leo-leo-token': 'leo-token',
  'near-near-protocol': 'near',
  'hbar-hedera-hashgraph': 'hedera-hashgraph',
  'avax-avalanche': 'avalanche-2',
  'toncoin-the-open-network': 'the-open-network',
  'cro-cryptocom-chain': 'crypto-com-chain',
  'qnt-quant': 'quant-network',
  'aave-new': 'aave',
  'pi2-pi-network': 'pi-network',
  'rndr-render-token': 'render-token',
  'inj-injective-protocol': 'injective-protocol',
};

const finiteMarketNumber = (value: unknown, fallback = 0) => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

export const normalizeCoinPaprikaTickers = (
  payload: unknown,
  currency: CurrencyCode,
): Coin[] => {
  if (!Array.isArray(payload)) return [];
  const quoteCurrency = currency.toUpperCase();
  const seen = new Set<string>();
  return (payload as CoinPaprikaTicker[]).flatMap((ticker): Coin[] => {
    const paprikaId = ticker.id ?? '';
    const id = coinGeckoIdByPaprikaId[paprikaId] ?? paprikaId.replace(/^[^-]+-/, '');
    const symbol = ticker.symbol?.trim().toLowerCase() ?? '';
    const name = ticker.name?.trim() ?? '';
    const quote = ticker.quotes?.[quoteCurrency];
    if (!id || !symbol || !name || !quote || seen.has(id)) return [];
    const currentPrice = finiteMarketNumber(quote.price);
    if (currentPrice <= 0) return [];
    seen.add(id);
    return [{
      id,
      symbol,
      name,
      image: `https://assets.coincap.io/assets/icons/${encodeURIComponent(symbol)}@2x.png`,
      current_price: currentPrice,
      market_cap: finiteMarketNumber(quote.market_cap),
      market_cap_rank: finiteMarketNumber(ticker.rank, seen.size),
      total_volume: finiteMarketNumber(quote.volume_24h),
      high_24h: currentPrice,
      low_24h: currentPrice,
      price_change_percentage_24h: finiteMarketNumber(quote.percent_change_24h),
      price_change_percentage_7d_in_currency: finiteMarketNumber(quote.percent_change_7d),
      price_change_percentage_30d_in_currency: finiteMarketNumber(quote.percent_change_30d),
      last_updated: ticker.last_updated,
    }];
  }).slice(0, 100);
};

const fetchCoinPaprikaSnapshot = async (currency: CurrencyCode): Promise<MarketSnapshot> => {
  const response = await axios.get<unknown>('https://api.coinpaprika.com/v1/tickers', {
    params: { quotes: currency.toUpperCase(), limit: 120 },
    timeout: 15_000,
    headers: { Accept: 'application/json' },
  });
  const coins = normalizeCoinPaprikaTickers(response.data, currency);
  if (coins.length === 0) throw new Error('The backup market provider did not contain any assets.');
  return {
    coins,
    metrics: null,
    warning: 'The primary market feed is temporarily unavailable. Live prices are being served by CoinPaprika.',
    source: 'coinpaprika',
    asOf: new Date().toISOString(),
  };
};

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

  const request = requestWithRetry(loader)
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

export const fetchMarketSnapshot = async (
  currency: CurrencyCode = 'usd',
  force = false,
): Promise<MarketSnapshot> => cachedRequest(`snapshot:${currency}`, 45_000, async () => {
  try {
    const response = await axios.get<MarketSnapshot>('/api/market/snapshot', {
      params: { currency },
      timeout: 20_000,
      headers: { Accept: 'application/json' },
    });
    if (!Array.isArray(response.data.coins) || response.data.coins.length === 0) {
      throw new Error('The market snapshot did not contain any assets.');
    }
    return { ...response.data, source: response.data.source ?? 'coingecko' };
  } catch {
    // Some hosts block server-to-server crypto market requests even though the
    // provider remains reachable from the visitor's browser. Keep the app
    // usable by moving the backup request client-side in that case.
    return fetchCoinPaprikaSnapshot(currency);
  }
}, force);

export const fetchCoinPrices = async (
  coinIds: string[],
  currency: CurrencyCode = 'usd',
): Promise<Map<string, number>> => {
  const ids = [...new Set(coinIds.filter((coinId) => /^[a-z0-9-]{1,100}$/.test(coinId)))].sort();
  if (ids.length === 0) return new Map();
  return cachedRequest(`simple-prices:${currency}:${ids.join(',')}`, 55_000, async () => {
    const response = await marketApi.get<Record<string, Partial<Record<CurrencyCode, number>>>>('/simple/price', {
      params: { ids: ids.join(','), vs_currencies: currency, precision: 'full' },
    });
    const prices = new Map<string, number>();
    ids.forEach((coinId) => {
      const price = response.data[coinId]?.[currency];
      if (typeof price === 'number' && Number.isFinite(price) && price > 0) prices.set(coinId, price);
    });
    return prices;
  });
};

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
  '1h': 2,
  '4h': 8,
  '12h': 24,
  '24h': 48,
};

const MIN_CANDLE_COUNT = 48;
const BINANCE_KLINE_LIMIT = 240;
const binanceIntervals: Record<CandleInterval, string> = {
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '12h': '12h',
  '24h': '1d',
};

const candleRecoveryDays = (interval: CandleInterval) => {
  const requestedDays = candleHistoryDays[interval];
  const requiredDays = Math.ceil((MIN_CANDLE_COUNT * candleIntervalMs[interval]) / (24 * 60 * 60_000));
  return Math.min(90, Math.max(requestedDays * 2, requiredDays * 2));
};

export const fetchCoinCandles = async (
  coinId: string,
  interval: CandleInterval,
  currency: CurrencyCode = 'usd',
  coinSymbol?: string,
): Promise<CandleData[]> => cachedRequest(`candles:v3:${coinId}:${coinSymbol ?? ''}:${interval}:${currency}`, 30_000, async () => {
  const parseCandles = (payload: { prices: [number, number][]; total_volumes: [number, number][] }) => {
    const bucketSize = candleIntervalMs[interval];
    const buckets = new Map<number, CandleData>();
    let previousVolume: number | null = null;
    payload.prices.forEach(([timestamp, price], index) => {
      const volumeTotal = payload.total_volumes[index]?.[1];
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
    return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
  };

  const requestCandles = async (days: number) => {
    const response = await marketApi.get<{
      prices: [number, number][];
      total_volumes: [number, number][];
    }>(`/coins/${encodeURIComponent(coinId)}/market_chart`, {
      params: { vs_currency: currency, days, precision: 'full' },
    });
    return parseCandles(response.data);
  };

  const fetchBinanceCandles = async (): Promise<CandleData[] | null> => {
    // Binance klines are USD-quoted USDT candles, so only use them when the
    // chart is displayed in USD. Other currencies stay on CoinGecko's
    // converted history rather than silently mixing units.
    const normalizedSymbol = coinSymbol?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (currency !== 'usd' || !normalizedSymbol) return null;

    const symbol = `${normalizedSymbol}USDT`;
    const params = { symbol, interval: binanceIntervals[interval], limit: BINANCE_KLINE_LIMIT };
    const endpoints = [
      'https://fapi.binance.com/fapi/v1/klines',
      'https://api.binance.com/api/v3/klines',
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await binanceApi.get<unknown>(endpoint, { params });
        if (!Array.isArray(response.data)) continue;
        const candles = response.data
          .map((row) => {
            if (!Array.isArray(row) || row.length < 7) return null;
            const [openTime, open, high, low, close, volume] = row;
            const timestamp = Number(openTime);
            const values = [Number(open), Number(high), Number(low), Number(close), Number(volume)];
            if (!Number.isFinite(timestamp) || values.some((value) => !Number.isFinite(value))) return null;
            return {
              timestamp,
              open: values[0],
              high: values[1],
              low: values[2],
              close: values[3],
              volume: Math.max(0, values[4]),
            } satisfies CandleData;
          })
          .filter((candle): candle is CandleData => candle !== null)
          .sort((a, b) => a.timestamp - b.timestamp);
        if (candles.length >= 2) return candles;
      } catch {
        // A token can exist on CoinGecko without a Binance pair. Move to the
        // spot endpoint, then let the existing CoinGecko path handle it.
      }
    }
    return null;
  };

  const exchangeCandles = await fetchBinanceCandles();
  if (exchangeCandles) return exchangeCandles;

  const requestedDays = candleHistoryDays[interval];
  let candles = await requestCandles(requestedDays);

  // CoinGecko can occasionally return a partial window during a rate-limit or
  // provider hiccup. Re-request a wider, still truthful market window before
  // exposing a chart with only a handful of candles.
  if (candles.length < MIN_CANDLE_COUNT && interval !== '5m' && interval !== '15m' && interval !== '30m') {
    candles = await requestCandles(candleRecoveryDays(interval));
  }

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

export const requestAIAnalysis = async (payload: AIAnalysisRequest | AIAnalysisSelectionRequest): Promise<AIAnalysis> => {
  const response = await axios.post<AIAnalysis>('/api/analyze', payload, {
    timeout: 100_000,
    headers: { 'Content-Type': 'application/json' },
  });
  return response.data;
};

export type ApiErrorContext = 'market' | 'ai' | 'auth' | 'partial' | 'general';

export const CONTROLLED_ERROR_MESSAGES = {
  genericMarket: 'We couldn’t load the latest market data. Please try again.',
  rateLimit: 'Market data is temporarily busy. Please try again in a moment.',
  timeout: 'The request took too long. Please try again.',
  network: 'We couldn’t connect to market data. Check your connection and try again.',
  partial: 'Some market data is temporarily unavailable. The rest of the dashboard is still available.',
  ai: 'We couldn’t complete the analysis. Please try again.',
  auth: 'Your session has expired. Please sign in again.',
  unknown: 'Something went wrong. Please try again.',
} as const;

export const getApiErrorMessage = (error: unknown, context: ApiErrorContext = 'market'): string => {
  // Always log the actual raw error for diagnostics and debugging
  console.error('API Error details:', error);

  // Preserve messages that are already part of our controlled vocabulary
  if (typeof error === 'string') {
    const controlledList: string[] = Object.values(CONTROLLED_ERROR_MESSAGES);
    if (controlledList.includes(error)) return error;
  }

  if (context === 'partial') {
    return CONTROLLED_ERROR_MESSAGES.partial;
  }

  let status: number | undefined;
  let code: string | undefined;
  let rawText = '';

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ error?: string }>;
    status = axiosError.response?.status;
    code = axiosError.code;
    const dataError = axiosError.response?.data?.error;
    rawText = typeof dataError === 'string' ? dataError : axiosError.message;
  } else if (error instanceof Error) {
    rawText = error.message;
  } else if (typeof error === 'string') {
    rawText = error;
  }

  const normalized = rawText.toLowerCase();

  // Rate limit
  if (status === 429 || /rate[- ]?limit|too many requests|quota|busy/i.test(normalized)) {
    return CONTROLLED_ERROR_MESSAGES.rateLimit;
  }

  // Timeout
  if (code === 'ECONNABORTED' || status === 408 || /timed?[- ]?out|abort/i.test(normalized)) {
    return CONTROLLED_ERROR_MESSAGES.timeout;
  }

  // Network failure
  if (
    (axios.isAxiosError(error) && !error.response) ||
    code === 'ERR_NETWORK' ||
    /network|offline|failed to fetch|connection/i.test(normalized)
  ) {
    return CONTROLLED_ERROR_MESSAGES.network;
  }

  // Authentication / session problem
  if (context === 'auth' || status === 401 || status === 403 || /expired|session|unauthorized|jwt|token/i.test(normalized)) {
    return CONTROLLED_ERROR_MESSAGES.auth;
  }

  // Partial data failure
  if (/partial|incomplete/i.test(normalized)) {
    return CONTROLLED_ERROR_MESSAGES.partial;
  }

  // AI request failure
  if (context === 'ai' || /analysis|ai brief|market brief/i.test(normalized)) {
    return CONTROLLED_ERROR_MESSAGES.ai;
  }

  // Generic market error
  if (context === 'market') {
    return CONTROLLED_ERROR_MESSAGES.genericMarket;
  }

  // Fallback unknown error
  return CONTROLLED_ERROR_MESSAGES.unknown;
};
