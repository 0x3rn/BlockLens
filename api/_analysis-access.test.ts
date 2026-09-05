import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisAccessError, consumeAnalysisQuota } from './_analysis-access';

const environment = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
};

describe('shared AI analysis quota', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends only a hash of the caller key to the server-only RPC', async () => {
    const request = vi.fn().mockResolvedValue(new Response('true', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', request);

    await consumeAnalysisQuota('web:198.51.100.7', environment);

    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://project.supabase.co/rest/v1/rpc/consume_ai_analysis_quota');
    expect(init.headers).toMatchObject({ apikey: 'server-only-key' });
    expect(init.body).not.toContain('198.51.100.7');
    expect(JSON.parse(init.body as string).p_key_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed when the shared quota denies or cannot evaluate a request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('false', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    await expect(consumeAnalysisQuota('caller', environment)).rejects.toMatchObject({ status: 429 } satisfies Partial<AnalysisAccessError>);

    await expect(consumeAnalysisQuota('caller', {})).rejects.toMatchObject({ status: 503 } satisfies Partial<AnalysisAccessError>);
  });
});
