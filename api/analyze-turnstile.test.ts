import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from './analyze';
import worker from '../worker/index';
import { buildAnalysisRequest } from './_market';
import { runAIAnalysis } from './_analysis';
import { consumeAnalysisQuota } from './_analysis-access';
import { resetAnalysisAdmissionForTests } from './_rate-limit';

vi.mock('./_analysis', async (original) => ({
  ...await original<typeof import('./_analysis')>(), isAIAnalysisConfigured: () => true, runAIAnalysis: vi.fn(),
}));
vi.mock('./_market', async (original) => ({
  ...await original<typeof import('./_market')>(), buildAnalysisRequest: vi.fn(),
}));
vi.mock('./_analysis-access', async (original) => ({
  ...await original<typeof import('./_analysis-access')>(), consumeAnalysisQuota: vi.fn(),
}));

const environment = { TURNSTILE_SECRET: 'server-test-secret', TURNSTILE_HOSTNAMES: 'blocklens.corstack.dev' };
const selection = { coinId: 'bitcoin', currency: 'usd', mode: 'swing', riskProfile: 'risk' };
const provider = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); resetAnalysisAdmissionForTests();
  vi.stubEnv('TURNSTILE_SECRET', environment.TURNSTILE_SECRET);
  vi.stubEnv('TURNSTILE_HOSTNAMES', environment.TURNSTILE_HOSTNAMES);
  vi.stubGlobal('fetch', provider);
  provider.mockReset();
  vi.mocked(buildAnalysisRequest).mockResolvedValue({ coinId: 'bitcoin' } as Awaited<ReturnType<typeof buildAnalysisRequest>>);
  vi.mocked(runAIAnalysis).mockResolvedValue({ headline: 'Validated brief' } as Awaited<ReturnType<typeof runAIAnalysis>>);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const invoke = async (adapter: 'vercel' | 'worker', body: unknown, configured = true) => {
  if (adapter === 'worker') {
    const response = await worker.fetch(new Request('https://blocklens.corstack.dev/api/analyze', {
      method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.7' }, body: JSON.stringify(body),
    }), { ...environment, ...(!configured ? { TURNSTILE_SECRET: '' } : {}), ASSETS: { fetch: vi.fn() } });
    return { status: response.status, body: await response.json() };
  }
  if (!configured) vi.stubEnv('TURNSTILE_SECRET', '');
  const result = { status: 200, body: undefined as unknown };
  const response = { setHeader: vi.fn(), status: (code: number) => { result.status = code; return response; }, json: (value: unknown) => { result.body = value; } };
  await handler({ method: 'POST', body, headers: { 'x-forwarded-for': '198.51.100.7' } }, response);
  return result;
};

describe.each(['vercel', 'worker'] as const)('%s Turnstile admission', (adapter) => {
  it.each(['missing', 'invalid', 'wrong-host', 'wrong-action', 'provider-outage', 'unconfigured'])('rejects %s before market fetching, quota writes, or Gemini', async (failure) => {
    let validation = { success: true, action: 'ai_analysis', hostname: 'blocklens.corstack.dev' };
    if (failure === 'invalid') validation = { ...validation, success: false };
    if (failure === 'wrong-host') validation = { ...validation, hostname: 'attacker.example' };
    if (failure === 'wrong-action') validation = { ...validation, action: 'signup' };
    provider.mockResolvedValue(new Response(JSON.stringify(validation), { status: failure === 'provider-outage' ? 502 : 200 }));
    const result = await invoke(adapter, { ...selection, ...(failure === 'missing' ? {} : { 'cf-turnstile-response': 'token' }) }, failure !== 'unconfigured');
    expect(result.status).toBe(failure === 'unconfigured' ? 503 : 403);
    expect(buildAnalysisRequest).not.toHaveBeenCalled();
    expect(consumeAnalysisQuota).not.toHaveBeenCalled();
    expect(runAIAnalysis).not.toHaveBeenCalled();
  });

  it('allows one validated request, retains risk settings and quotas, and rejects a replay', async () => {
    provider.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, action: 'ai_analysis', hostname: 'blocklens.corstack.dev' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: false, 'error-codes': ['timeout-or-duplicate'] })));
    const body = { ...selection, 'cf-turnstile-response': 'single-use-token' };
    expect((await invoke(adapter, body)).status).toBe(200);
    expect(buildAnalysisRequest).toHaveBeenCalledTimes(1);
    expect(consumeAnalysisQuota).toHaveBeenCalledTimes(1);
    expect(runAIAnalysis).toHaveBeenCalledWith({ coinId: 'bitcoin', riskProfile: 'risk' }, expect.any(Object), adapter === 'worker' ? 'fetch' : 'node');
    expect(provider.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(buildAnalysisRequest).mock.invocationCallOrder[0]);
    expect((await invoke(adapter, body)).status).toBe(403);
    expect(buildAnalysisRequest).toHaveBeenCalledTimes(1);
    expect(consumeAnalysisQuota).toHaveBeenCalledTimes(1);
    expect(runAIAnalysis).toHaveBeenCalledTimes(1);
  });
});
