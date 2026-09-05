import { runAIAnalysis, AnalysisError, isAIAnalysisConfigured, normalizeAIAnalysisRequest } from '../api/_analysis.ts';
import { consumeAnalysisQuota, AnalysisAccessError } from '../api/_analysis-access.ts';
import { acquireAnalysisSlot, isRateLimited } from '../api/_rate-limit.ts';
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

export const readJsonBody = async (request: Request): Promise<BodyResult> => {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { ok: false, response: json({ error: 'The request is too large.' }, 413) };
  }

  if (!request.body) {
    return { ok: false, response: json({ error: 'The request body is not valid JSON.' }, 400) };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        return { ok: false, response: json({ error: 'The request is too large.' }, 413) };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, response: json({ error: 'The request body could not be read.' }, 400) };
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  let rawBody: string;
  try {
    rawBody = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, response: json({ error: 'The request body is not valid JSON.' }, 400) };
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

  const quotaKey = `web:${clientKey(request)}`;
  if (isRateLimited(quotaKey)) {
    return json({ error: 'Too many analysis requests. Please wait a minute and retry.' }, 429);
  }

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  let releaseSlot: (() => void) | null = null;
  try {
    if (!isAIAnalysisConfigured(env)) {
      return json({ error: 'Gemini trading analysis is not configured on this deployment yet.' }, 503);
    }
    const input = normalizeAIAnalysisRequest(body.value);
    if (!input) return json({ error: 'The supplied market data is incomplete or invalid.' }, 400);
    releaseSlot = acquireAnalysisSlot();
    if (!releaseSlot) return json({ error: 'AI analysis is busy. Please retry shortly.' }, 429);
    await consumeAnalysisQuota(quotaKey, env);
    const analysis = await runAIAnalysis(input, env, 'fetch');
    return json(analysis, 200, { 'Cache-Control': 'no-store' });
  } catch (error) {
    if (error instanceof AnalysisAccessError) return json({ error: error.message }, error.status);
    if (error instanceof AnalysisError) return json({ error: error.message }, error.status);
    console.error('Cloudflare AI analysis request failed:', error instanceof Error ? error.message : 'Unknown provider error');
    return json({ error: 'The AI market brief is temporarily unavailable.' }, 502);
  } finally {
    releaseSlot?.();
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
