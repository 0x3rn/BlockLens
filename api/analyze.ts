import { processEnvironment } from './_env.ts';
import { isRateLimited } from './_rate-limit.ts';
import { AnalysisError, runAIAnalysis } from './_analysis.ts';

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

  if (isRateLimited(readClientIp(request))) {
    return response.status(429).json({ error: 'Too many analysis requests. Please wait a minute and retry.' });
  }

  try {
    const analysis = await runAIAnalysis(readBody(request), processEnvironment(), 'node');
    return response.status(200).json(analysis);
  } catch (error) {
    if (error instanceof AnalysisError) return response.status(error.status).json({ error: error.message });
    console.error('AI analysis request failed:', error instanceof Error ? error.message : 'Unknown provider error');
    return response.status(502).json({ error: 'The AI market brief is temporarily unavailable.' });
  }
}
