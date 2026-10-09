import type { ServerEnvironment } from './_env.ts';

export const ANALYSIS_TURNSTILE_ACTION = 'ai_analysis';
export type TurnstileAction = typeof ANALYSIS_TURNSTILE_ACTION | 'password_login' | 'password_signup';

export class TurnstileError extends Error {
  readonly code: string;
  constructor(public readonly status: 403 | 503) {
    super(status === 403
      ? 'Please complete verification and try again.'
      : 'Analysis is temporarily unavailable. Please try again later.');
    this.code = status === 403 ? 'TURNSTILE_VERIFICATION_FAILED' : 'TURNSTILE_UNAVAILABLE';
  }
}

/** Redeem once; never retry Siteverify or log its token, secret, or raw response. */
export async function verifyTurnstile(body: unknown, env: ServerEnvironment, action: TurnstileAction, clientIp?: string) {
  const secret = env.TURNSTILE_SECRET?.trim();
  const hostnames = (env.TURNSTILE_HOSTNAMES ?? '').split(',').map((value) => value.trim().toLowerCase());
  const validHostname = (hostname: string) => hostname.length <= 253
    && hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!secret || !hostnames.length || hostnames.some((hostname) => !validHostname(hostname))) {
    throw new TurnstileError(503);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TurnstileError(403);
  const { 'cf-turnstile-response': token, ...payload } = body as Record<string, unknown>;
  if (typeof token !== 'string' || !token.trim() || token.length > 2048) throw new TurnstileError(403);

  const form = new URLSearchParams({ secret, response: token });
  // IP is optional: omit unknown values. Callers use their hosting proxy's header.
  if (clientIp && clientIp !== 'anonymous') form.set('remoteip', clientIp);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new TurnstileError(403);
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object') throw new TurnstileError(403);
    const validation = result as Record<string, unknown>;
    if (validation.success !== true || validation.action !== action
      || typeof validation.hostname !== 'string' || !hostnames.includes(validation.hostname.toLowerCase())) {
      throw new TurnstileError(403);
    }
  } catch {
    // Fail closed on timeouts, provider errors, malformed JSON, and expired/replayed tokens.
    throw new TurnstileError(403);
  }
  return payload;
}

export const verifyAnalysisTurnstile = (body: unknown, env: ServerEnvironment, clientIp?: string) =>
  verifyTurnstile(body, env, ANALYSIS_TURNSTILE_ACTION, clientIp);
