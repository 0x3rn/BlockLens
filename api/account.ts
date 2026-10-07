import { AccountError, executeAccountQuery } from './_account.ts';
import { processEnvironment } from './_env.ts';

export default async function handler(
  request: { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> },
  response: { status: (code: number) => typeof response; json: (body: unknown) => void; setHeader: (name: string, value: string) => void },
) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ data: null, error: { message: 'Only POST requests are accepted.' } });
  }
  try {
    if (JSON.stringify(request.body ?? '').length > 1_000_000) throw new AccountError(413, 'The account request is too large.');
    let body = request.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { throw new AccountError(400, 'Invalid account request.'); }
    }
    const authorization = request.headers.authorization;
    const data = await executeAccountQuery(body, typeof authorization === 'string' ? authorization : null, processEnvironment());
    return response.status(200).json({ data, error: null });
  } catch (error) {
    // Database diagnostics and credentials must never enter a browser response.
    const status = error instanceof AccountError ? error.status : 503;
    const message = error instanceof AccountError ? error.message : 'Account sync is temporarily unavailable.';
    return response.status(status).json({ data: null, error: { message } });
  }
}
