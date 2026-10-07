import type { ServerEnvironment } from './_env.ts';
import { databaseClient } from './_database.ts';

export class AnalysisAccessError extends Error {
  constructor(public readonly status: 429 | 503, message: string) {
    super(message);
    this.name = 'AnalysisAccessError';
  }
}

const hashQuotaKey = async (key: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const consumeAnalysisQuota = async (key: string, environment: ServerEnvironment): Promise<void> => {
  if (!environment.DATABASE_URL?.trim()) {
    throw new AnalysisAccessError(503, 'AI analysis quotas are not configured on this deployment yet.');
  }
  let allowed: unknown;
  try {
    const sql = databaseClient(environment);
    const rows = await sql`select public.consume_ai_analysis_quota(${await hashQuotaKey(key)}) as allowed`;
    allowed = rows[0]?.allowed;
  } catch {
    throw new AnalysisAccessError(503, 'AI analysis quotas are temporarily unavailable.');
  }
  if (allowed === false) {
    throw new AnalysisAccessError(429, 'Too many analysis requests. Please wait and retry.');
  }
  if (allowed !== true) throw new AnalysisAccessError(503, 'AI analysis quotas are temporarily unavailable.');
};
