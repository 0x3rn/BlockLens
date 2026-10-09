import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TurnstileError, verifyAnalysisTurnstile } from './_turnstile';

const env = { TURNSTILE_SECRET: 'private-test-secret', TURNSTILE_HOSTNAMES: 'blocklens.corstack.dev' };
const payload = { coinId: 'bitcoin', currency: 'usd', mode: 'swing', 'cf-turnstile-response': 'fresh-token' };
const valid = { success: true, action: 'ai_analysis', hostname: 'blocklens.corstack.dev' };
const provider = vi.fn();
beforeEach(() => { provider.mockReset(); vi.stubGlobal('fetch', provider); });
afterEach(() => vi.unstubAllGlobals());

describe('Turnstile server verification', () => {
  it('redeems a token against Siteverify and removes it from the analysis input', async () => {
    provider.mockResolvedValue(new Response(JSON.stringify(valid)));
    await expect(verifyAnalysisTurnstile(payload, env, '198.51.100.5')).resolves.toEqual({ coinId: 'bitcoin', currency: 'usd', mode: 'swing' });
    const [url, options] = provider.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(options.body)).toEqual({ secret: env.TURNSTILE_SECRET, response: 'fresh-token', remoteip: '198.51.100.5' });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([undefined, '', ' ', 12, [], 'a'.repeat(2049)])('rejects missing or malformed tokens without a provider call (%s)', async (token) => {
    await expect(verifyAnalysisTurnstile({ ...payload, 'cf-turnstile-response': token }, env)).rejects.toMatchObject({ status: 403 });
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    {}, { TURNSTILE_SECRET: 'secret' }, { ...env, TURNSTILE_HOSTNAMES: '' },
    { ...env, TURNSTILE_HOSTNAMES: 'https://blocklens.corstack.dev' },
    { ...env, TURNSTILE_HOSTNAMES: '*.corstack.dev' },
    { ...env, TURNSTILE_HOSTNAMES: 'blocklens.corstack.dev,' },
  ])('fails closed for absent or malformed deployment configuration', async (configuration) => {
    await expect(verifyAnalysisTurnstile(payload, configuration)).rejects.toMatchObject({ status: 503 });
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    { ...valid, success: 'true' }, { ...valid, success: false, 'error-codes': ['timeout-or-duplicate'] },
    { ...valid, action: 'login' }, { ...valid, action: undefined },
    { ...valid, hostname: 'evil.example' }, { ...valid, hostname: 'other.corstack.dev' },
    { ...valid, hostname: undefined }, null,
  ])('rejects failed validation, replay, wrong action, and wrong hostname', async (result) => {
    provider.mockResolvedValue(new Response(JSON.stringify(result)));
    await expect(verifyAnalysisTurnstile(payload, env)).rejects.toBeInstanceOf(TurnstileError);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each(['http', 'json', 'network', 'timeout'])('fails closed without retrying on %s failure', async (failure) => {
    if (failure === 'http') provider.mockResolvedValue(new Response('{}', { status: 503 }));
    if (failure === 'json') provider.mockResolvedValue(new Response('invalid-json'));
    if (failure === 'network') provider.mockRejectedValue(new Error('network unavailable'));
    if (failure === 'timeout') provider.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    await expect(verifyAnalysisTurnstile(payload, env)).rejects.toMatchObject({ status: 403, code: 'TURNSTILE_VERIFICATION_FAILED' });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('uses exact, deployment-specific frontend hostnames and omits an unknown IP', async () => {
    provider.mockImplementation(async () => new Response(JSON.stringify({ ...valid, hostname: 'localhost' })));
    await expect(verifyAnalysisTurnstile(payload, env, 'anonymous')).rejects.toMatchObject({ status: 403 });
    expect(provider.mock.calls[0][1].body.has('remoteip')).toBe(false);
    await expect(verifyAnalysisTurnstile(payload, { ...env, TURNSTILE_HOSTNAMES: 'localhost,127.0.0.1' })).resolves.toHaveProperty('coinId', 'bitcoin');
  });

  it('accepts exact preview hostnames with consecutive hyphens', async () => {
    const hostname = 'blocklens-git-feature--preview.vercel.app';
    provider.mockResolvedValue(new Response(JSON.stringify({ ...valid, hostname })));
    await expect(verifyAnalysisTurnstile(payload, { ...env, TURNSTILE_HOSTNAMES: hostname })).resolves.toHaveProperty('coinId', 'bitcoin');
  });
});
