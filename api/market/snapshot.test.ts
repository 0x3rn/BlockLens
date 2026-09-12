import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from './snapshot';
import { fetchGlobalMarketMetrics, fetchTopCoins } from '../_market';

vi.mock('../_market', () => ({ fetchTopCoins: vi.fn(), fetchGlobalMarketMetrics: vi.fn() }));

const createResponse = () => {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status: vi.fn((code: number) => { statusCode = code; return response; }),
    json: vi.fn((value: unknown) => { body = value; }),
    setHeader: vi.fn(),
  };
  return { response, getStatus: () => statusCode, getBody: () => body };
};

describe('market snapshot endpoint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns coins and metrics from the server-side provider cache', async () => {
    vi.mocked(fetchTopCoins).mockResolvedValue([{ id: 'bitcoin' }] as Awaited<ReturnType<typeof fetchTopCoins>>);
    vi.mocked(fetchGlobalMarketMetrics).mockResolvedValue({ totalMarketCap: 1 } as Awaited<ReturnType<typeof fetchGlobalMarketMetrics>>);
    const { response, getStatus, getBody } = createResponse();
    await handler({ method: 'GET', query: { currency: 'usd' } }, response);
    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({ coins: [{ id: 'bitcoin' }], metrics: { totalMarketCap: 1 }, warning: null });
  });

  it('keeps coin data available when optional global metrics fail', async () => {
    vi.mocked(fetchTopCoins).mockResolvedValue([{ id: 'bitcoin' }] as Awaited<ReturnType<typeof fetchTopCoins>>);
    vi.mocked(fetchGlobalMarketMetrics).mockRejectedValue(new Error('rate limited'));
    const { response, getStatus, getBody } = createResponse();
    await handler({ method: 'GET', query: { currency: 'usd' } }, response);
    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({ coins: [{ id: 'bitcoin' }], metrics: null, warning: expect.stringMatching(/metrics/i) });
  });

  it('rejects unsupported methods', async () => {
    const { response, getStatus } = createResponse();
    await handler({ method: 'POST' }, response);
    expect(getStatus()).toBe(405);
  });
});
