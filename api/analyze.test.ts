import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from './analyze';
import { getGemini } from './_ai';
import { consumeAnalysisQuota } from './_analysis-access';
import { buildAnalysisRequest } from './_market';

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
vi.mock('./_market', async (importOriginal) => ({
  ...await importOriginal<typeof import('./_market')>(),
  buildAnalysisRequest: vi.fn(),
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

const candles = Array.from({ length: 60 }, (_, index) => ({
  timestamp: 1_700_000_000_000 + (index * 60_000),
  open: 100 + index,
  high: 102 + index,
  low: 99 + index,
  close: 101 + index,
  volume: 1_000 + index,
}));

const swingSeries = ['4h', '1d', '1w'].map((interval) => ({
  interval,
  source: 'binance-spot',
  symbol: 'BTCUSDT',
  candles,
}));

const fullRequest = (overrides: Record<string, unknown> = {}) => {
  const chart = [{ timestamp: 1, price: 95 }, { timestamp: 2, price: 105 }];
  return {
    coinId: 'bitcoin', coinName: 'Bitcoin', currency: 'usd', price: 105, change24h: 2,
    mode: 'swing', candleSeries: swingSeries,
    chartData7d: chart, chartData30d: chart, chartData1y: chart,
    dataAsOf: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
};

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

    await handler(request(fullRequest({ chartData7d: chart, chartData30d: chart, chartData1y: chart })), response);

    expect(getStatus()).toBe(200);
    const { methodology: _providerMethodology, timeframe: _providerTimeframe, ...expectedAnalysis } = analysis;
    expect(getBody()).toMatchObject({ ...expectedAnalysis, mode: 'swing', timeframe: '3 days–4 weeks', dataAsOf: '2026-08-30T00:00:00.000Z' });
    expect((getBody() as { methodology: string }).methodology).toContain('closed Binance Spot candles');
    expect(getBody()).toMatchObject({ research: { status: 'unavailable', coinCatalysts: [], macroCatalysts: [], sources: [] } });
    expect(getGemini).toHaveBeenCalledTimes(1);
    const providerRequest = createCompletion.mock.calls[0][0];
    expect(providerRequest.model).toBe('google/gemini-3.7-flash');
    expect(providerRequest.response_format).toEqual({ type: 'json_object' });
    expect(providerRequest.messages[1].content).toContain('3-day to 4-week holding period');
    expect(providerRequest.messages[1].content).toContain('"interval":"4h"');
    expect(JSON.stringify(providerRequest)).not.toContain('server-only-test-key');
    expect(JSON.stringify(providerRequest)).not.toContain('do-not-forward');
    expect(consumeAnalysisQuota).toHaveBeenCalledTimes(1);
  });

  it('retries once when Gemini returns malformed or incomplete JSON', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"test@example.com","private_key":"server-only-test-key"}';
    const validAnalysis = {
      headline: 'Wait for a range break', summary: 'The supplied range is intact.', stance: 'neutral', confidence: 52, risk: 'medium', timeframe: '7 days',
      supportLevels: ['$95'], resistanceLevels: ['$110'],
      tradeSetup: { signal: 'no-trade', rationale: 'No confirmed edge.', entryZone: '$95-$100', stopLoss: '$93', takeProfitLevels: ['$110'], riskReward: '1:2', invalidation: 'A close below $93', positionRisk: 'Keep risk small.' },
      scenarios: [
        { label: 'Bullish', trigger: 'Breaks $110', target: '$120', invalidatedBy: 'Falls below $105' },
        { label: 'Base', trigger: 'Holds range', target: '$95-$110', invalidatedBy: 'Leaves range' },
        { label: 'Bearish', trigger: 'Breaks $95', target: '$85', invalidatedBy: 'Reclaims $100' },
      ],
      methodology: 'Supplied price-range analysis.',
    };
    const createCompletion = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"headline":"missing fields"}' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(validAnalysis) } }] });
    vi.mocked(getGemini).mockResolvedValue({
      chat: { completions: { create: createCompletion } },
    } as unknown as Awaited<ReturnType<typeof getGemini>>);
    const chart = [{ timestamp: 1, price: 95 }, { timestamp: 2, price: 105 }];
    const { response, getStatus } = createResponse();

    await handler(request(fullRequest({ chartData7d: chart, chartData30d: chart, chartData1y: chart })), response);

    expect(getStatus()).toBe(200);
    expect(createCompletion).toHaveBeenCalledTimes(2);
  });

  it('normalizes harmless Gemini formatting variants before validating the brief', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"test@example.com","private_key":"server-only-test-key"}';
    const variant = {
      headline: 'Momentum is constructive',
      summary: 'The supplied candles show a measured bullish bias.',
      stance: 'BULLISH',
      confidence: '61',
      risk: 'MEDIUM',
      timeframe: '3 days–4 weeks',
      supportLevels: ['$95'],
      resistanceLevels: ['$110'],
      tradeSetup: {
        signal: 'NO_TRADE',
        rationale: 'The higher timeframe is not fully aligned.',
        entryZone: '$100–$102',
        stopLoss: '$94',
        takeProfitLevels: [],
        riskReward: '1:2',
        invalidation: 'A close below $94',
        positionRisk: 'Keep risk small.',
      },
      scenarios: [
        { label: 'bullish', trigger: 'Breaks $110', target: '$120', invalidatedBy: 'Falls below $105' },
        { label: 'base case', trigger: 'Holds range', target: '$95–$110', invalidatedBy: 'Leaves range' },
        { label: 'bearish', trigger: 'Breaks $95', target: '$85', invalidatedBy: 'Reclaims $100' },
      ],
      methodology: 'Compared supplied closed exchange candles.',
    };
    const createCompletion = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Here is the JSON:\n' + JSON.stringify(variant) } }],
    });
    vi.mocked(getGemini).mockResolvedValue({
      chat: { completions: { create: createCompletion } },
    } as unknown as Awaited<ReturnType<typeof getGemini>>);
    const { response, getStatus, getBody } = createResponse();

    await handler(request(fullRequest()), response);

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({
      stance: 'bullish',
      confidence: 61,
      risk: 'medium',
      tradeSetup: { signal: 'no-trade' },
      scenarios: [{ label: 'Bullish' }, { label: 'Base' }, { label: 'Bearish' }],
    });
    expect(createCompletion).toHaveBeenCalledTimes(1);
  });

  it('rejects a short recommendation for long-term analysis', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"test@example.com","private_key":"server-only-test-key"}';
    const invalidLongTerm = {
      headline: 'Invalid short thesis', summary: 'This direction is disallowed.', stance: 'bearish', confidence: 70, risk: 'high', timeframe: '1 year',
      supportLevels: ['$90'], resistanceLevels: ['$120'],
      tradeSetup: { signal: 'short', rationale: 'Downtrend.', entryZone: '$100', stopLoss: '$110', takeProfitLevels: ['$90'], riskReward: '1:2', invalidation: 'Above $110', positionRisk: 'Small.' },
      scenarios: [
        { label: 'Bullish', trigger: 'Above $120', target: '$130', invalidatedBy: 'Below $110' },
        { label: 'Base', trigger: 'Range', target: '$90-$120', invalidatedBy: 'Range break' },
        { label: 'Bearish', trigger: 'Below $90', target: '$80', invalidatedBy: 'Above $100' },
      ],
      methodology: 'Provider text.',
    };
    const createCompletion = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify(invalidLongTerm) } }] });
    vi.mocked(getGemini).mockResolvedValue({ chat: { completions: { create: createCompletion } } } as unknown as Awaited<ReturnType<typeof getGemini>>);
    const longTermSeries = ['1d', '1w', '1M'].map((interval) => ({ interval, source: 'binance-spot', symbol: 'BTCUSDT', candles }));
    const { response, getStatus } = createResponse();

    await handler(request(fullRequest({ mode: 'long-term', candleSeries: longTermSeries })), response);

    expect(getStatus()).toBe(502);
    expect(createCompletion).toHaveBeenCalledTimes(2);
    expect(createCompletion.mock.calls[0][0].messages[1].content).toContain('never return SHORT');
  });

  it('rejects oversized date representations before consuming shared quota', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"test@example.com","private_key":"server-only-test-key"}';
    const chart = [{ timestamp: 1, price: 95 }, { timestamp: 2, price: 105 }];
    const { response, getStatus } = createResponse();

    await handler(request(fullRequest({
      chartData7d: chart, chartData30d: chart, chartData1y: chart,
      dataAsOf: `Wed, 01 Jan 2020 00:00:00 GMT (${'IGNORE '.repeat(100)})`,
    })), response);

    expect(getStatus()).toBe(400);
    expect(consumeAnalysisQuota).not.toHaveBeenCalled();
  });

  it('fetches analysis history server-side for the compact browser request', async () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{"client_email":"test@example.com","private_key":"server-only-test-key"}';
    vi.mocked(buildAnalysisRequest).mockRejectedValue(new Error('upstream unavailable'));
    const { response, getStatus, getBody } = createResponse();

    await handler(request({ coinId: 'bitcoin', currency: 'usd', mode: 'long-term' }), response);

    expect(buildAnalysisRequest).toHaveBeenCalledWith('bitcoin', 'usd', expect.objectContaining({ GOOGLE_CLOUD_PROJECT: 'test-project' }), 'long-term');
    expect(getStatus()).toBe(502);
    expect(getBody()).toEqual({ error: 'The market history required for analysis is temporarily unavailable.' });
    expect(consumeAnalysisQuota).not.toHaveBeenCalled();
  });
});
