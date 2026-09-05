import { processEnvironment } from './_env.ts';
import { consumeAnalysisQuota, AnalysisAccessError } from './_analysis-access.ts';
import { acquireAnalysisSlot, isRateLimited } from './_rate-limit.ts';
import { AnalysisError, isAIAnalysisConfigured, normalizeAIAnalysisRequest, runAIAnalysis } from './_analysis.ts';

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type RequestLike = {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
};

const readClientIp = (request: RequestLike) => {
  const forwarded = request.headers['x-forwarded-for'];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || 'anonymous';
};

const readBody = (request: RequestLike): unknown => {
  if (typeof request.body !== 'string') return request.body;
  try {
    return JSON.parse(request.body);
  } catch {
    return null;
  }
};

export default async function handler(request: RequestLike, response: ResponseLike) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Only POST requests are accepted.' });
  }

  const quotaKey = `web:${readClientIp(request)}`;
  if (isRateLimited(quotaKey)) {
    return response.status(429).json({ error: 'Too many analysis requests. Please wait a minute and retry.' });
  }

  let releaseSlot: (() => void) | null = null;
  try {
    const environment = processEnvironment();
    if (!isAIAnalysisConfigured(environment)) {
      return response.status(503).json({ error: 'Gemini trading analysis is not configured on this deployment yet.' });
    }
    const input = normalizeAIAnalysisRequest(readBody(request));
    if (!input) return response.status(400).json({ error: 'The supplied market data is incomplete or invalid.' });
    releaseSlot = acquireAnalysisSlot();
    if (!releaseSlot) return response.status(429).json({ error: 'AI analysis is busy. Please retry shortly.' });
    await consumeAnalysisQuota(quotaKey, environment);
    const analysis = await runAIAnalysis(input, environment, 'node');
    return response.status(200).json(analysis);
  } catch (error) {
    if (error instanceof AnalysisAccessError) return response.status(error.status).json({ error: error.message });
    if (error instanceof AnalysisError) return response.status(error.status).json({ error: error.message });
    console.error('AI analysis request failed:', error instanceof Error ? error.message : 'Unknown provider error');
    return response.status(502).json({ error: 'The AI market brief is temporarily unavailable.' });
  } finally {
    releaseSlot?.();
  }
}
