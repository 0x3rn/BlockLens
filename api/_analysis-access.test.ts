import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeAnalysisQuota } from './_analysis-access';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./_database.ts', () => ({ databaseClient: () => mocks.query }));

const environment = {
  DATABASE_URL: 'postgresql://owner:secret@ep-example.neon.tech/neondb?sslmode=require',
};

describe('shared AI analysis quota', () => {
  afterEach(() => mocks.query.mockReset());

  it('sends only a hash of the caller key to the server-only RPC', async () => {
    mocks.query.mockResolvedValue([{ allowed: true }]);

    await consumeAnalysisQuota('web:198.51.100.7', environment);

    const [parts, key] = mocks.query.mock.calls[0];
    expect(parts.join('')).toContain('public.consume_ai_analysis_quota');
    expect(key).not.toContain('198.51.100.7');
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed when the shared quota denies or cannot evaluate a request', async () => {
    mocks.query.mockResolvedValue([{ allowed: false }]);
    await expect(consumeAnalysisQuota('caller', environment)).rejects.toMatchObject({ status: 429 });

    await expect(consumeAnalysisQuota('caller', {})).rejects.toMatchObject({ status: 503 });
    mocks.query.mockRejectedValue(new Error('unavailable'));
    await expect(consumeAnalysisQuota('caller', environment)).rejects.toMatchObject({ status: 503 });
    mocks.query.mockResolvedValue([{ allowed: null }]);
    await expect(consumeAnalysisQuota('caller', environment)).rejects.toMatchObject({ status: 503 });
  });
});
