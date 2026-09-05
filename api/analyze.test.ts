import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from './analyze';
import { getGemini } from './_ai';
import { consumeAnalysisQuota } from './_analysis-access';

vi.mock('./_ai', () => ({ getGemini: vi.fn() }));
vi.mock('./_vertex-fetch', () => ({ requestVertexCompletion: vi.fn(), requestVertexGroundedResearch: vi.fn() }));
vi.mock('./_analysis-access', () => ({
  AnalysisAccessError: class AnalysisAccessError extends Error {
    constructor(public readonly status: 429 | 503, message: string) {
      super(message);
    }
  },
  consumeAnalysisQuota: vi.fn(),
}));

const createResponse = () => {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status: vi.fn((code: number) => {
      statusCode = code;
      return response;
    }),
    json: vi.fn((value: unknown) => { body = value; }),
    setHeader: vi.fn(),
  };
  return { response, getStatus: () => statusCode, getBody: () => body };
};

const request = (body: unknown, method = 'POST') => ({
  method,
  body,
  headers: { 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 100)}` },
});

describe('AI analysis function', () => {
  const originalProject = process.env.GOOGLE_CLOUD_PROJECT;
  const originalCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  afterEach(() => {
    if (originalProject == null) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = originalProject;
    if (originalCredentials == null) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = originalCredentials;
    vi.clearAllMocks();
  });

  it('rejects methods other than POST', async () => {
    const { response, getStatus } = createResponse();
    await handler(request(undefined, 'GET'), response);
    expect(getStatus()).toBe(405);
    expect(response.setHeader).toHaveBeenCalledWith('Allow', 'POST');
  });

  it('reports missing server-side configuration without exposing a key', async () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const { response, getStatus, getBody } = createResponse();
    await handler(request({}), response);
    expect(getStatus()).toBe(503);
    expect(getBody()).toEqual({ error: 'Gemini trading analysis is not configured on this deployment yet.' });
  });

  it('returns a validated structured brief for valid provider JSON', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"test@example.com","private_key":"server-only-test-key"}';
    const analysis = {
      headline: 'Range holds while momentum improves',
      summary: 'Price remains within the supplied historical range.',
      stance: 'neutral',
      confidence: 61,
      risk: 'high',
      timeframe: '7–30 days',
      supportLevels: ['$95'],
      resistanceLevels: ['$110'],
      tradeSetup: {
        signal: 'long',
        rationale: 'Price is holding above the supplied range midpoint.',
        entryZone: '$102–$105',
        stopLoss: '$94',
        takeProfitLevels: ['$110', '$120'],
        riskReward: 'Approximately 1:2',
        invalidation: 'A close below $94',
        positionRisk: 'Risk only a small, predefined portion of capital.',
      },
      scenarios: [
        { label: 'Bullish', trigger: 'Closes above $110', target: '$120', invalidatedBy: 'Returns below $105' },
        { label: 'Base', trigger: 'Stays in range', target: '$95–$110', invalidatedBy: 'Leaves the range' },
        { label: 'Bearish', trigger: 'Breaks below $95', target: '$85', invalidatedBy: 'Recovers $100' },
      ],
      methodology: 'Compared supplied 7-day, 30-day, and one-year price samples.',
    };
    const createCompletion = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(analysis) } }],
    });
    vi.mocked(getGemini).mockResolvedValue({
      chat: { completions: { create: createCompletion } },
    } as unknown as Awaited<ReturnType<typeof getGemini>>);
    const chart = [
      { timestamp: 1, price: 95, marketCap: 1_000, injected: 'do-not-forward' },
      { timestamp: 2, price: 105, volume: 500 },
    ];
    const { response, getStatus, getBody } = createResponse();

    await handler(request({
      coinId: 'bitcoin',
      coinName: 'Bitcoin',
      currency: 'usd',
      price: 105,
      change24h: 2,
      chartData7d: chart,
      chartData30d: chart,
      chartData1y: chart,
      dataAsOf: '2026-08-30T00:00:00.000Z',
    }), response);

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({ ...analysis, dataAsOf: '2026-08-30T00:00:00.000Z' });
    expect(getBody()).toMatchObject({ research: { status: 'unavailable', coinCatalysts: [], macroCatalysts: [], sources: [] } });
    expect(getGemini).toHaveBeenCalledTimes(1);
    const providerRequest = createCompletion.mock.calls[0][0];
    expect(providerRequest.model).toBe('google/gemini-3.7-flash');
    expect(providerRequest.response_format).toEqual({ type: 'json_object' });
    expect(JSON.stringify(providerRequest)).not.toContain('server-only-test-key');
    expect(JSON.stringify(providerRequest)).not.toContain('do-not-forward');
    expect(consumeAnalysisQuota).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized date representations before consuming shared quota', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"test@example.com","private_key":"server-only-test-key"}';
    const chart = [{ timestamp: 1, price: 95 }, { timestamp: 2, price: 105 }];
    const { response, getStatus } = createResponse();

    await handler(request({
      coinId: 'bitcoin',
      coinName: 'Bitcoin',
      currency: 'usd',
      price: 105,
      change24h: 2,
      chartData7d: chart,
      chartData30d: chart,
      chartData1y: chart,
      dataAsOf: `Wed, 01 Jan 2020 00:00:00 GMT (${'IGNORE '.repeat(100)})`,
    }), response);

    expect(getStatus()).toBe(400);
    expect(consumeAnalysisQuota).not.toHaveBeenCalled();
  });
});
