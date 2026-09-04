import { runAIAnalysis, AnalysisError } from '../api/_analysis.ts';
import { isRateLimited } from '../api/_rate-limit.ts';
import { fetchTopCoins } from '../api/_market.ts';
import { processTelegramUpdate } from '../api/telegram/webhook.ts';
import type { ServerEnvironment } from '../api/_env.ts';
import type { TelegramUpdate } from '../api/telegram/_telegram.ts';
import type { CurrencyCode } from '../src/types/crypto.ts';

type AssetBinding = {
  fetch: (request: Request) => Promise<Response>;
};

type WorkerEnvironment = ServerEnvironment & {
  ASSETS: AssetBinding;
};

const MAX_BODY_BYTES = 1_000_000;
const supportedCurrencies = new Set<CurrencyCode>(['usd', 'eur', 'gbp', 'ngn']);

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  },
});

const clientKey = (request: Request) => (
  request.headers.get('cf-connecting-ip')
  ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  ?? 'anonymous'
);

type BodyResult =
  | { ok: true; value: unknown }
  | { ok: false; response: Response };

const readJsonBody = async (request: Request): Promise<BodyResult> => {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { ok: false, response: json({ error: 'The request is too large.' }, 413) };
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return { ok: false, response: json({ error: 'The request is too large.' }, 413) };
  }

  try {
    return { ok: true, value: JSON.parse(rawBody) };
  } catch {
    return { ok: false, response: json({ error: 'The request body is not valid JSON.' }, 400) };
  }
};

const handleAnalysis = async (request: Request, env: WorkerEnvironment): Promise<Response> => {
  if (request.method !== 'POST') {
    return json({ error: 'Only POST requests are accepted.' }, 405, { Allow: 'POST' });
  }

  if (isRateLimited(clientKey(request))) {
    return json({ error: 'Too many analysis requests. Please wait a minute and retry.' }, 429);
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  try {
    const analysis = await runAIAnalysis(body.value, env, 'fetch');
    return json(analysis, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    if (error instanceof AnalysisError) return json({ error: error.message }, error.status);
    console.error('Cloudflare AI analysis request failed:', error instanceof Error ? error.message : 'Unknown provider error');
    return json({ error: 'The AI market brief is temporarily unavailable.' }, 502);
  }
};

const handleTelegramCoins = async (request: Request, env: WorkerEnvironment): Promise<Response> => {
  if (request.method !== 'GET') {
    return json({ error: 'Only GET requests are accepted.' }, 405, { Allow: 'GET' });
  }

  const requestedCurrency = new URL(request.url).searchParams.get('currency');
  const currency = requestedCurrency && supportedCurrencies.has(requestedCurrency as CurrencyCode)
    ? requestedCurrency as CurrencyCode
    : 'usd';

  try {
    const coins = await fetchTopCoins(currency, env);
    return json({
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
    }, 200, {
      'Cache-Control': 'public, max-age=45, s-maxage=45, stale-while-revalidate=120',
    });
  } catch (error) {
    console.error('Cloudflare Telegram coin list failed:', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'The live coin list is temporarily unavailable.' }, 502);
  }
};

const handleTelegramWebhook = async (request: Request, env: WorkerEnvironment): Promise<Response> => {
  if (request.method !== 'POST') {
    return json({ error: 'Only POST requests are accepted.' }, 405, { Allow: 'POST' });
  }

  const configuredSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const providedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!configuredSecret || providedSecret !== configuredSecret) {
    return json({ error: 'Invalid webhook credentials.' }, 401);
  }
  if (!env.TELEGRAM_BOT_TOKEN?.trim()) {
    return json({ error: 'The Telegram bot is not configured.' }, 503);
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  try {
    await processTelegramUpdate(body.value as TelegramUpdate, env, 'fetch');
  } catch (error) {
    console.error('Cloudflare Telegram webhook failed:', error instanceof Error ? error.message : 'Unknown error');
    // Acknowledge a valid update so Telegram does not retry a downstream failure.
  }

  return json({ ok: true }, 200, { 'Cache-Control': 'no-store' });
};

const notFound = () => json({ error: 'Not found.' }, 404);

const worker = {
  async fetch(request: Request, env: WorkerEnvironment): Promise<Response> {
    const pathname = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/api/analyze') return handleAnalysis(request, env);
    if (pathname === '/api/telegram/coins') return handleTelegramCoins(request, env);
    if (pathname === '/api/telegram/webhook') return handleTelegramWebhook(request, env);
    if (pathname === '/api' || pathname.startsWith('/api/')) return notFound();

    return env.ASSETS.fetch(request);
  },
};

export default worker;
