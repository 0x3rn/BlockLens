import { processEnvironment } from '../_env.ts';
import { fetchGlobalMarketMetrics, fetchTopCoins } from '../_market.ts';
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

export default async function handler(request: RequestLike, response: ResponseLike) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'public, s-maxage=45, stale-while-revalidate=120');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Only GET requests are accepted.' });
  }

  const currency = readCurrency(request);
  try {
    const [coins, metricsResult] = await Promise.all([
      fetchTopCoins(currency, processEnvironment()),
      fetchGlobalMarketMetrics(currency, processEnvironment()).then(
        (metrics) => ({ metrics, error: null }),
        () => ({ metrics: null, error: 'Global market metrics are temporarily unavailable.' }),
      ),
    ]);
    return response.status(200).json({
      coins,
      metrics: metricsResult.metrics,
      warning: metricsResult.error,
      asOf: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Market snapshot failed:', error instanceof Error ? error.message : 'Unknown provider error');
    return response.status(502).json({ error: 'The live market snapshot is temporarily unavailable.' });
  }
}
