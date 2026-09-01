export type CurrencyCode = 'usd' | 'eur' | 'gbp' | 'ngn';

export interface Coin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  price_change_percentage_24h: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  price_change_percentage_30d_in_currency?: number | null;
  sparkline_in_7d?: { price: number[] };
  last_updated?: string;
}

export interface CoinDetail {
  id: string;
  symbol: string;
  name: string;
  image: { large: string; small: string; thumb: string };
  description?: { en?: string };
  links?: { homepage?: string[]; blockchain_site?: string[] };
  market_data: {
    current_price: Record<CurrencyCode, number>;
    market_cap: Record<CurrencyCode, number>;
    market_cap_rank: number;
    total_volume: Record<CurrencyCode, number>;
    high_24h: Record<CurrencyCode, number>;
    low_24h: Record<CurrencyCode, number>;
    ath: Record<CurrencyCode, number>;
    ath_date: Record<CurrencyCode, string>;
    atl: Record<CurrencyCode, number>;
    atl_date: Record<CurrencyCode, string>;
    price_change_percentage_24h: number;
    price_change_percentage_7d: number;
    price_change_percentage_30d: number;
    price_change_percentage_90d?: number;
    price_change_percentage_180d?: number;
    price_change_percentage_1y: number;
    total_supply: number | null;
    circulating_supply: number | null;
    max_supply: number | null;
  };
  last_updated?: string;
}

export interface ChartData {
  timestamp: number;
  price: number;
  marketCap?: number;
  volume?: number;
}

export type CandleInterval = '5m' | '15m' | '30m' | '1h' | '4h' | '12h' | '24h';

export interface CandleData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LiveSpotTrade {
  id: string;
  timestamp: number;
  price: number;
  quantity: number;
  quoteValue: number;
  side: 'buy' | 'sell';
}

export interface LiveLiquidation {
  id: string;
  timestamp: number;
  symbol: string;
  side: 'long' | 'short';
  price: number;
  quantity: number;
  quoteValue: number;
}

export interface MarketMetrics {
  totalMarketCap: number;
  totalVolume24h: number;
  marketCapChange24h: number;
  bitcoinDominance: number;
  activeCryptocurrencies: number;
  trackedMarkets: number;
  updatedAt: number;
}

export interface TrendingCoin {
  id: string;
  name: string;
  symbol: string;
  image: string;
  marketCapRank: number | null;
  score: number;
}

export interface PortfolioPosition {
  coinId: string;
  quantity: number;
  averageCost: number;
  currency: CurrencyCode;
  updatedAt: string;
}

export type AlertCondition = 'above' | 'below' | 'change';

export interface PriceAlert {
  id: string;
  coinId: string;
  condition: AlertCondition;
  threshold: number;
  currency: CurrencyCode;
  createdAt: string;
  triggeredAt?: string;
}

export interface MarketScenario {
  label: 'Bullish' | 'Base' | 'Bearish';
  trigger: string;
  target: string;
  invalidatedBy: string;
}

export interface TradeSetup {
  signal: 'long' | 'short' | 'no-trade';
  rationale: string;
  entryZone: string;
  stopLoss: string;
  takeProfitLevels: string[];
  riskReward: string;
  invalidation: string;
  positionRisk: string;
}

export interface AIAnalysis {
  headline: string;
  summary: string;
  stance: 'bullish' | 'neutral' | 'bearish';
  confidence: number;
  risk: 'low' | 'medium' | 'high';
  timeframe: string;
  supportLevels: string[];
  resistanceLevels: string[];
  tradeSetup: TradeSetup;
  scenarios: MarketScenario[];
  methodology: string;
  dataAsOf: string;
  generatedAt: string;
}

export interface AIAnalysisRequest {
  coinId: string;
  coinName: string;
  currency: CurrencyCode;
  price: number;
  change24h: number;
  chartData7d: ChartData[];
  chartData30d: ChartData[];
  chartData1y: ChartData[];
  dataAsOf: string;
}
