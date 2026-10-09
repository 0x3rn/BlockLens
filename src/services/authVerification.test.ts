import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyPasswordAuth } from './authVerification';

const api = vi.fn();
beforeEach(() => { api.mockReset(); vi.stubGlobal('fetch', api); });
afterEach(() => vi.unstubAllGlobals());

describe('password verification client', () => {
  it.each(['sign-in', 'sign-up'] as const)('sends only the %s operation and one-use token to its own endpoint', async operation => {
    api.mockResolvedValue(new Response(JSON.stringify({ verified: true })));
    await expect(verifyPasswordAuth(operation, 'fresh-token')).resolves.toBeUndefined();
    const [url, options] = api.mock.calls[0];
    expect(url).toBe('/api/auth/verify');
    expect(JSON.parse(options.body)).toEqual({ operation, 'cf-turnstile-response': 'fresh-token' });
    expect(options.cache).toBe('no-store');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it('does not send a request with an empty token', async () => {
    await expect(verifyPasswordAuth('sign-in', ' ')).rejects.toMatchObject({ code: 'TURNSTILE_VERIFICATION_FAILED' });
    expect(api).not.toHaveBeenCalled();
  });
  it.each([[403, 'TURNSTILE_VERIFICATION_FAILED'], [429, 'auth/too-many-requests'], [503, 'TURNSTILE_UNAVAILABLE']])('maps %s to a controlled error', async (status, code) => {
    api.mockResolvedValue(new Response(JSON.stringify({ error: 'private diagnostic' }), { status: status as number }));
    await expect(verifyPasswordAuth('sign-in', 'token')).rejects.toEqual({ code });
  });
  it.each(['invalid-json', 'false', 'missing', 'string'])('fails closed for malformed success %s', async variant => {
    const body = variant === 'invalid-json' ? 'not json' : JSON.stringify(variant === 'false' ? { verified: false } : variant === 'string' ? { verified: 'true' } : {});
    api.mockResolvedValue(new Response(body));
    await expect(verifyPasswordAuth('sign-up', 'token')).rejects.toEqual({ code: 'TURNSTILE_UNAVAILABLE' });
  });
  it('does not expose or log network diagnostics', async () => {
    api.mockRejectedValue(new Error('private diagnostic'));
    await expect(verifyPasswordAuth('sign-in', 'token')).rejects.toEqual({ code: 'auth/network-request-failed' });
  });
});
