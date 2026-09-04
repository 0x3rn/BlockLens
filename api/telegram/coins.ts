import { fetchTopCoins } from '../_market.ts';
import { processEnvironment } from '../_env.ts';
import type { CurrencyCode } from '../../src/types/crypto.ts';

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type RequestLike = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
};

const supportedCurrencies = new Set<CurrencyCode>(['usd', 'eur', 'gbp', 'ngn']);

const readCurrency = (request: RequestLike): CurrencyCode => {
  const raw = request.query?.currency;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && supportedCurrencies.has(value as CurrencyCode) ? value as CurrencyCode : 'usd';
};

/** Public, cached market list used by the Telegram selector. */
export default async function handler(request: RequestLike, response: ResponseLike) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'public, s-maxage=45, stale-while-revalidate=120');

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Only GET requests are accepted.' });
  }

  try {
    const coins = await fetchTopCoins(readCurrency(request), processEnvironment());
    return response.status(200).json({
      coins: coins.map((coin) => ({
        id: coin.id,
        name: coin.name,
        symbol: coin.symbol,
        image: coin.image,
        rank: coin.market_cap_rank,
        price: coin.current_price,
        change24h: coin.price_change_percentage_24h,
      })),
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Telegram coin list failed:', error instanceof Error ? error.message : 'Unknown error');
    return response.status(502).json({ error: 'The live coin list is temporarily unavailable.' });
  }
}
