import { processEnvironment } from '../_env.ts';
import { authVerificationFailure, verifyPasswordAuth } from '../_auth-verification.ts';

export default async function handler(
  request: { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> },
  response: { status: (code: number) => typeof response; json: (body: unknown) => void; setHeader: (name: string, value: string) => void },
) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Only POST requests are accepted.' });
  }
  if (JSON.stringify(request.body ?? '').length > 8_192) {
    return response.status(413).json({ error: 'The verification request is too large.' });
  }
  let body = request.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const forwarded = request.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  try {
    await verifyPasswordAuth(body, processEnvironment(), ip);
    return response.status(200).json({ verified: true });
  } catch (error) {
    const failure = authVerificationFailure(error);
    return response.status(failure.status).json(failure.body);
  }
}
