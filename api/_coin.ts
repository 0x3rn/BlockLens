import { getCoinGeckoConfig } from './_market.ts';
import type { ServerEnvironment } from './_env.ts';
import type { CoinDetail } from '../src/types/crypto.ts';
import { fetchBackupCoinProfile } from './_coin-backup.ts';

export class CoinProfileError extends Error {
  constructor(public readonly status: 404 | 503, message: string) { super(message); }
}
const cache = new Map<string, { coin: CoinDetail; expiresAt: number }>();
const pending = new Map<string, Promise<CoinDetail>>();
export const isCoinId = (id: string) => /^[a-z0-9-]{1,100}$/.test(id);
export const clearCoinProfileCache = () => { cache.clear(); pending.clear(); };

export async function fetchCoinProfile(id: string, environment: ServerEnvironment): Promise<CoinDetail> {
  if (!isCoinId(id)) throw new CoinProfileError(404, 'This asset could not be found.');
  const hit = cache.get(id);
  if (hit && hit.expiresAt > Date.now()) return hit.coin;
  const inFlight = pending.get(id);
  if (inFlight) return inFlight;
  const request = loadCoinProfile(id, environment).catch(async error => {
    const backup = await fetchBackupCoinProfile(id).catch(() => null);
    if (backup) return backup;
    throw error;
  }).then(coin => {
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(id, { coin, expiresAt: Date.now() + 5 * 60_000 });
    return coin;
  }).finally(() => pending.delete(id));
  pending.set(id, request);
  return request;
}

async function loadCoinProfile(id: string, environment: ServerEnvironment): Promise<CoinDetail> {
  const config = getCoinGeckoConfig(environment);
  const query = 'localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false';
  const endpoint = '/coins/' + encodeURIComponent(id) + '?' + query;
  try {
    let response = await fetch(config.baseUrl + endpoint, {
      headers: config.headers, signal: AbortSignal.timeout(12_000),
    });
    if ((response.status === 401 || response.status === 403) && config.plan !== 'keyless') {
      await response.body?.cancel();
      response = await fetch('https://api.coingecko.com/api/v3' + endpoint, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000),
      });
    }
    if (response.status === 404) throw new CoinProfileError(404, 'This asset could not be found.');
    if (!response.ok) throw new CoinProfileError(503, 'Asset data is temporarily unavailable. Please try again.');
    const data = await response.json() as CoinDetail;
    const requiredMaps = ['current_price', 'market_cap', 'total_volume', 'high_24h', 'low_24h', 'ath', 'ath_date', 'atl', 'atl_date'] as const;
    if (data.id !== id || typeof data.name !== 'string' || typeof data.symbol !== 'string' ||
        typeof data.image?.large !== 'string' || !data.market_data ||
        !Number.isFinite(data.market_data.current_price?.usd) ||
        requiredMaps.some(key => !data.market_data[key] || typeof data.market_data[key] !== 'object')) {
      throw new CoinProfileError(503, 'Asset data is temporarily unavailable. Please try again.');
    }
    return {
      id: data.id, name: data.name, symbol: data.symbol, image: data.image,
      description: { en: data.description?.en?.slice(0, 20_000) },
      links: { homepage: data.links?.homepage, blockchain_site: data.links?.blockchain_site },
      market_data: data.market_data, last_updated: data.last_updated,
      dataSource: 'coingecko',
    };
  } catch (error) {
    if (error instanceof CoinProfileError) throw error;
    throw new CoinProfileError(503, 'Asset data is temporarily unavailable. Please try again.');
  }
}
