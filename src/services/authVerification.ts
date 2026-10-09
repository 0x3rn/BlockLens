export type PasswordAuthOperation = 'sign-in' | 'sign-up';

export async function verifyPasswordAuth(operation: PasswordAuthOperation, token: string): Promise<void> {
  if (!token.trim()) throw { code: 'TURNSTILE_VERIFICATION_FAILED' };
  let response: Response;
  try {
    response = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation, 'cf-turnstile-response': token }),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
  } catch { throw { code: 'auth/network-request-failed' }; }
  if (response.status === 429) throw { code: 'auth/too-many-requests' };
  if (response.status === 403) throw { code: 'TURNSTILE_VERIFICATION_FAILED' };
  let body: unknown;
  try { body = await response.json(); } catch { throw { code: 'TURNSTILE_UNAVAILABLE' }; }
  if (!response.ok || !body || typeof body !== 'object' || !('verified' in body) || body.verified !== true) {
    throw { code: 'TURNSTILE_UNAVAILABLE' };
  }
}
