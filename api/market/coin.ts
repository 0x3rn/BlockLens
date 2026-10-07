import { CoinProfileError, fetchCoinProfile } from '../_coin.ts';
import { processEnvironment } from '../_env.ts';

type RequestLike = { method?: string; query?: Record<string, string | string[] | undefined> };
type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};
export default async function handler(request: RequestLike, response: ResponseLike) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Only GET requests are accepted.' });
  }
  const raw = request.query?.coinId;
  try {
    const coin = await fetchCoinProfile(typeof raw === 'string' ? raw : '', processEnvironment());
    response.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    return response.status(200).json(coin);
  } catch (error) {
    const status = error instanceof CoinProfileError ? error.status : 503;
    if (status === 503) response.setHeader('Retry-After', '60');
    return response.status(status).json({ error: status === 404 ? 'This asset could not be found.' : 'Asset data is temporarily unavailable. Please try again.' });
  }
}
