import type { CoinDetail, CurrencyCode } from '../src/types/crypto.ts';

// These provider identifiers were checked against CoinPaprika's active-asset catalog.
// Do not guess by symbol: bridged tokens and unrelated assets can share a symbol.
const paprikaIdByCoinId: Record<string, string> = {
  stellar: 'xlm-stellar', tron: 'trx-tron', solana: 'sol-solana',
  'leo-token': 'leo-leo-token', usds: 'usds-usds', monero: 'xmr-monero',
  chainlink: 'link-chainlink', cardano: 'ada-cardano', whitebit: 'wbt-whitebit',
  'usd-coin': 'usdc-usd-coin',
};

type Quote = {
  price?: number; market_cap?: number; volume_24h?: number;
  ath_price?: number; ath_date?: string;
  percent_change_24h?: number; percent_change_7d?: number;
  percent_change_30d?: number; percent_change_1y?: number;
};
type Ticker = {
  id?: string; name?: string; symbol?: string; rank?: number;
  quotes?: Record<string, Quote>;
  circulating_supply?: number; total_supply?: number; max_supply?: number;
  last_updated?: string;
};
type Profile = { id?: string; description?: string; links?: { website?: string[]; explorer?: string[] } };

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch('https://api.coinpaprika.com/v1' + path, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Backup asset data unavailable.');
  return await response.json() as T;
}

export async function fetchBackupCoinProfile(id: string): Promise<CoinDetail | null> {
  const paprikaId = paprikaIdByCoinId[id];
  if (!paprikaId) return null;
  const [ticker, profile] = await Promise.all([
    getJson<Ticker>('/tickers/' + paprikaId + '?quotes=USD,EUR,GBP,NGN'),
    getJson<Profile>('/coins/' + paprikaId).catch(() => null),
  ]);
  if (ticker.id !== paprikaId || !ticker.name || !ticker.symbol || !Number.isFinite(ticker.quotes?.USD?.price)) {
    throw new Error('Invalid backup asset data.');
  }
  const numberMap = (key: keyof Quote): Partial<Record<CurrencyCode, number>> =>
    Object.fromEntries((['usd', 'eur', 'gbp', 'ngn'] as const).flatMap(currency => {
      const value = ticker.quotes?.[currency.toUpperCase()]?.[key];
      return typeof value === 'number' && Number.isFinite(value) ? [[currency, value]] : [];
    }));
  const usd = ticker.quotes!.USD;
  const number = (value?: number) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const image = 'https://assets.coincap.io/assets/icons/' + encodeURIComponent(ticker.symbol.toLowerCase()) + '@2x.png';
  return {
    id, name: ticker.name, symbol: ticker.symbol.toLowerCase(),
    image: { large: image, small: image, thumb: image },
    description: { en: profile?.id === paprikaId ? profile.description?.slice(0, 20_000) : undefined },
    links: { homepage: profile?.links?.website, blockchain_site: profile?.links?.explorer },
    dataSource: 'coinpaprika', last_updated: ticker.last_updated,
    market_data: {
      current_price: numberMap('price'), market_cap: numberMap('market_cap'), total_volume: numberMap('volume_24h'),
      market_cap_rank: ticker.rank ?? 0, high_24h: {}, low_24h: {}, ath: numberMap('ath_price'),
      ath_date: Object.fromEntries((['usd', 'eur', 'gbp', 'ngn'] as const).flatMap(currency => {
        const value = ticker.quotes?.[currency.toUpperCase()]?.ath_date;
        return typeof value === 'string' ? [[currency, value]] : [];
      })),
      atl: {}, atl_date: {},
      price_change_percentage_24h: number(usd.percent_change_24h),
      price_change_percentage_7d: number(usd.percent_change_7d),
      price_change_percentage_30d: number(usd.percent_change_30d),
      price_change_percentage_1y: number(usd.percent_change_1y),
      circulating_supply: number(ticker.circulating_supply), total_supply: number(ticker.total_supply), max_supply: number(ticker.max_supply),
    },
  };
}
