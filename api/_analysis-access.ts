import type { ServerEnvironment } from './_env.ts';

export class AnalysisAccessError extends Error {
  constructor(public readonly status: 429 | 503, message: string) {
    super(message);
    this.name = 'AnalysisAccessError';
  }
}

const quotaEndpoint = (environment: ServerEnvironment) => {
  const baseUrl = environment.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!baseUrl || !serviceRoleKey) {
    throw new AnalysisAccessError(503, 'AI analysis quotas are not configured on this deployment yet.');
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new AnalysisAccessError(503, 'AI analysis quotas are not configured on this deployment yet.');
  }
  const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    throw new AnalysisAccessError(503, 'AI analysis quotas are not configured on this deployment yet.');
  }
  return { endpoint: `${parsed.origin}/rest/v1/rpc/consume_ai_analysis_quota`, serviceRoleKey };
};

const hashQuotaKey = async (key: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const consumeAnalysisQuota = async (key: string, environment: ServerEnvironment): Promise<void> => {
  const { endpoint, serviceRoleKey } = quotaEndpoint(environment);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_key_hash: await hashQuotaKey(key) }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AnalysisAccessError(503, 'AI analysis quotas are temporarily unavailable.');
  }
  if (!response.ok) {
    throw new AnalysisAccessError(503, 'AI analysis quotas are temporarily unavailable.');
  }
  let allowed: unknown;
  try {
    allowed = await response.json();
  } catch {
    throw new AnalysisAccessError(503, 'AI analysis quotas are temporarily unavailable.');
  }
  if (allowed !== true) {
    throw new AnalysisAccessError(429, 'Too many analysis requests. Please wait and retry.');
  }
};
