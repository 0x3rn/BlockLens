import type { ServerEnvironment } from './_env.ts';
import { isRateLimited } from './_rate-limit.ts';
import { TurnstileError, verifyTurnstile } from './_turnstile.ts';

export class AuthVerificationError extends Error {
  constructor(public readonly status: 400 | 429, message: string) { super(message); }
}

export async function verifyPasswordAuth(body: unknown, env: ServerEnvironment, clientIp?: string) {
  if (isRateLimited(`auth:${clientIp || 'anonymous'}`)) {
    throw new AuthVerificationError(429, 'Too many attempts. Please wait a minute and try again.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AuthVerificationError(400, 'Please try signing in again.');
  }
  const input = body as Record<string, unknown>;
  if (input.operation !== 'sign-in' && input.operation !== 'sign-up') {
    throw new AuthVerificationError(400, 'Please try signing in again.');
  }
  // This endpoint accepts only a verification token and operation, never credentials.
  await verifyTurnstile({ 'cf-turnstile-response': input['cf-turnstile-response'] }, env,
    input.operation === 'sign-in' ? 'password_login' : 'password_signup', clientIp);
}

export const authVerificationFailure = (error: unknown) => ({
  status: error instanceof TurnstileError || error instanceof AuthVerificationError ? error.status : 503,
  body: {
    error: error instanceof TurnstileError && error.status === 403 || error instanceof AuthVerificationError
      ? error.message : 'Sign-in is temporarily unavailable. Please try again later.',
    code: error instanceof TurnstileError ? error.code : 'AUTH_VERIFICATION_FAILED',
  },
});
