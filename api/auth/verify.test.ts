import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from './verify';
import worker from '../../worker/index';
import { resetAnalysisAdmissionForTests } from '../_rate-limit';

const env = { TURNSTILE_SECRET: 'private-test-secret', TURNSTILE_HOSTNAMES: 'blocklens.corstack.dev' };
const provider = vi.fn();
beforeEach(() => {
  resetAnalysisAdmissionForTests(); provider.mockReset();
  vi.stubEnv('TURNSTILE_SECRET', env.TURNSTILE_SECRET); vi.stubEnv('TURNSTILE_HOSTNAMES', env.TURNSTILE_HOSTNAMES);
  vi.stubGlobal('fetch', provider);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const invoke = async (adapter: 'vercel' | 'worker', body: unknown, method = 'POST', configured = true) => {
  if (adapter === 'worker') {
    const response = await worker.fetch(new Request('https://blocklens.corstack.dev/api/auth/verify', {
      method, headers: { 'CF-Connecting-IP': '198.51.100.10' }, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    }), { ...env, ...(!configured ? { TURNSTILE_SECRET: '' } : {}), ASSETS: { fetch: vi.fn() } });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  }
  if (!configured) vi.stubEnv('TURNSTILE_SECRET', '');
  const result = { status: 200, body: undefined as unknown, cache: null as string | null };
  const response = {
    setHeader: (name: string, value: string) => { if (name === 'Cache-Control') result.cache = value; },
    status: (code: number) => { result.status = code; return response; }, json: (value: unknown) => { result.body = value; },
  };
  await handler({ method, body, headers: { 'x-forwarded-for': '198.51.100.10' } }, response);
  return result;
};
const validation = (action = 'password_login', hostname = 'blocklens.corstack.dev', success = true) =>
  new Response(JSON.stringify({ success, action, hostname }));

describe.each(['vercel', 'worker'] as const)('%s password verification', adapter => {
  it.each([['sign-in', 'password_login'], ['sign-up', 'password_signup']])('accepts a fresh %s token and rejects replay', async (operation, action) => {
    provider.mockResolvedValueOnce(validation(action)).mockResolvedValueOnce(validation(action, undefined, false));
    const body = { operation, 'cf-turnstile-response': 'single-use-token' };
    expect(await invoke(adapter, body)).toMatchObject({ status: 200, body: { verified: true }, cache: 'no-store' });
    expect(await invoke(adapter, body)).toMatchObject({ status: 403, body: { code: 'TURNSTILE_VERIFICATION_FAILED' } });
    const [url, options] = provider.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(Object.fromEntries(options.body)).toEqual({ secret: env.TURNSTILE_SECRET, response: 'single-use-token', remoteip: '198.51.100.10' });
  });

  it.each(['ai_analysis', 'password_signup'])('rejects a %s token on the login form', async action => {
    provider.mockResolvedValue(validation(action));
    expect((await invoke(adapter, { operation: 'sign-in', 'cf-turnstile-response': 'token' })).status).toBe(403);
  });
  it('rejects a login token on the registration form', async () => {
    provider.mockResolvedValue(validation());
    expect((await invoke(adapter, { operation: 'sign-up', 'cf-turnstile-response': 'token' })).status).toBe(403);
  });
  it('fails closed for a wrong hostname or provider outage', async () => {
    provider.mockResolvedValueOnce(validation('password_login', 'evil.example')).mockRejectedValueOnce(new Error('private diagnostic'));
    const body = { operation: 'sign-in', 'cf-turnstile-response': 'token' };
    expect((await invoke(adapter, body)).status).toBe(403);
    expect(await invoke(adapter, body)).toMatchObject({ status: 403, body: { error: 'Please complete verification and try again.' } });
  });
  it('does not call Siteverify without a token or for Google/unknown operations', async () => {
    expect((await invoke(adapter, { operation: 'sign-in' })).status).toBe(403);
    expect((await invoke(adapter, { operation: 'google', 'cf-turnstile-response': 'token' })).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });
  it('uses sign-in wording for unavailable configuration and sends no credentials to Siteverify', async () => {
    expect(await invoke(adapter, { operation: 'sign-in', 'cf-turnstile-response': 'token' }, 'POST', false))
      .toMatchObject({ status: 503, body: { error: 'Sign-in is temporarily unavailable. Please try again later.' } });
    expect(provider).not.toHaveBeenCalled();
  });
  it('rejects invalid methods, malformed JSON, and oversized requests', async () => {
    expect((await invoke(adapter, {}, 'GET')).status).toBe(405);
    expect((await invoke(adapter, '{')).status).toBe(400);
    expect((await invoke(adapter, { operation: 'sign-in', padding: 'x'.repeat(9_000) })).status).toBe(413);
    expect(provider).not.toHaveBeenCalled();
  });
  it('limits verification attempts separately from AI analysis', async () => {
    for (let attempt = 0; attempt < 8; attempt++) await invoke(adapter, { operation: 'sign-in' });
    expect(await invoke(adapter, { operation: 'sign-in' })).toMatchObject({ status: 429 });
    expect(provider).not.toHaveBeenCalled();
  });
});
