import type { AIAnalysis, AIAnalysisRequest, ChartData } from '../src/types/crypto.ts';
import type { ServerEnvironment } from './_env.ts';
import { requestVertexCompletion } from './_vertex-fetch.ts';

export class AnalysisError extends Error {
  constructor(public readonly status: 400 | 502 | 503, message: string) {
    super(message);
    this.name = 'AnalysisError';
  }
}

const samplePoints = (points: ChartData[], count: number) => {
  if (points.length <= count) return points;
  const step = (points.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => points[Math.round(index * step)]);
};

const isChart = (value: unknown): value is ChartData[] => (
  Array.isArray(value)
  && value.length <= 2_000
  && value.every((point) => (
    point
    && typeof point === 'object'
    && Number.isFinite((point as ChartData).timestamp)
    && Number.isFinite((point as ChartData).price)
  ))
);

const isText = (value: unknown, maxLength = 1_200): value is string => (
  typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
);

const isTextList = (value: unknown): value is string[] => (
  Array.isArray(value)
  && value.length > 0
  && value.length <= 8
  && value.every((item) => isText(item, 120))
);

const isScenario = (value: unknown, label: string): boolean => {
  if (!value || typeof value !== 'object') return false;
  const scenario = value as Record<string, unknown>;
  return scenario.label === label
    && isText(scenario.trigger, 500)
    && isText(scenario.target, 500)
    && isText(scenario.invalidatedBy, 500);
};

const isCurrency = (value: unknown): value is AIAnalysisRequest['currency'] => (
  value === 'usd' || value === 'eur' || value === 'gbp' || value === 'ngn'
);

const isValidRequest = (value: unknown): value is AIAnalysisRequest => {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return typeof input.coinId === 'string'
    && /^[a-z0-9-]{1,100}$/.test(input.coinId)
    && typeof input.coinName === 'string'
    && input.coinName.length >= 1
    && input.coinName.length <= 80
    && isCurrency(input.currency)
    && Number.isFinite(input.price)
    && Number.isFinite(input.change24h)
    && isChart(input.chartData7d)
    && input.chartData7d.length >= 2
    && isChart(input.chartData30d)
    && input.chartData30d.length >= 2
    && isChart(input.chartData1y)
    && input.chartData1y.length >= 2
    && typeof input.dataAsOf === 'string'
    && !Number.isNaN(Date.parse(input.dataAsOf));
};

const isConfigured = (environment: ServerEnvironment) => (
  Boolean(environment.GOOGLE_CLOUD_PROJECT?.trim() && environment.GOOGLE_SERVICE_ACCOUNT_JSON?.trim())
);

const buildPrompt = (input: AIAnalysisRequest) => {
  const marketSnapshot = {
    coin: input.coinName,
    currency: input.currency,
    currentPrice: input.price,
    change24h: input.change24h,
    dataAsOf: input.dataAsOf,
    sevenDay: samplePoints(input.chartData7d, 24),
    thirtyDay: samplePoints(input.chartData30d, 30),
    oneYear: samplePoints(input.chartData1y, 40),
  };

  return `Create an educational market brief from the supplied price and volume history.

Rules:
- Provide one conditional technical setup: LONG, SHORT, or NO TRADE. Choose NO TRADE whenever the supplied data does not show a defensible edge.
- The setup must include a price-based entry zone, stop loss, take-profit levels, risk/reward estimate, invalidation condition, and conservative position-risk note.
- Never promise profit, imply certainty, recommend leverage, or present the setup as personalized financial advice.
- Present uncertainty and three conditional scenarios: Bullish, Base, and Bearish.
- Use only the supplied data. Do not invent news, sentiment, catalysts, indicators, or exact precision unsupported by the sample.
- Support and resistance values must be expressed as human-readable price strings in ${input.currency.toUpperCase()}.
- Confidence must be an integer from 0 to 100 and reflect data limitations.
- Return valid JSON only with this exact shape:
{
  "headline": "string",
  "summary": "string",
  "stance": "bullish | neutral | bearish",
  "confidence": 0,
  "risk": "low | medium | high",
  "timeframe": "string",
  "supportLevels": ["string"],
  "resistanceLevels": ["string"],
  "tradeSetup": {
    "signal": "long | short | no-trade",
    "rationale": "string",
    "entryZone": "string",
    "stopLoss": "string",
    "takeProfitLevels": ["string"],
    "riskReward": "string",
    "invalidation": "string",
    "positionRisk": "string"
  },
  "scenarios": [
    {"label":"Bullish","trigger":"string","target":"string","invalidatedBy":"string"},
    {"label":"Base","trigger":"string","target":"string","invalidatedBy":"string"},
    {"label":"Bearish","trigger":"string","target":"string","invalidatedBy":"string"}
  ],
  "methodology": "string"
}

Market snapshot:
${JSON.stringify(marketSnapshot)}`;
};

const validateProviderAnalysis = (value: unknown): value is AIAnalysis => {
  if (!value || typeof value !== 'object') return false;
  const analysis = value as Record<string, unknown>;
  const tradeSetup = analysis.tradeSetup;
  return isText(analysis.headline, 180)
    && isText(analysis.summary, 1_500)
    && ['bullish', 'neutral', 'bearish'].includes(analysis.stance as string)
    && Number.isInteger(analysis.confidence)
    && (analysis.confidence as number) >= 0
    && (analysis.confidence as number) <= 100
    && ['low', 'medium', 'high'].includes(analysis.risk as string)
    && isText(analysis.timeframe, 120)
    && isTextList(analysis.supportLevels)
    && isTextList(analysis.resistanceLevels)
    && Boolean(tradeSetup)
    && typeof tradeSetup === 'object'
    && ['long', 'short', 'no-trade'].includes((tradeSetup as Record<string, unknown>).signal as string)
    && isText((tradeSetup as Record<string, unknown>).rationale, 800)
    && isText((tradeSetup as Record<string, unknown>).entryZone, 180)
    && isText((tradeSetup as Record<string, unknown>).stopLoss, 180)
    && isTextList((tradeSetup as Record<string, unknown>).takeProfitLevels)
    && isText((tradeSetup as Record<string, unknown>).riskReward, 180)
    && isText((tradeSetup as Record<string, unknown>).invalidation, 500)
    && isText((tradeSetup as Record<string, unknown>).positionRisk, 500)
    && Array.isArray(analysis.scenarios)
    && analysis.scenarios.length === 3
    && isScenario(analysis.scenarios[0], 'Bullish')
    && isScenario(analysis.scenarios[1], 'Base')
    && isScenario(analysis.scenarios[2], 'Bearish')
    && isText(analysis.methodology, 1_500);
};

export type ProviderKind = 'node' | 'fetch';

const requestProviderContent = async (
  prompt: string,
  environment: ServerEnvironment,
  provider: ProviderKind,
): Promise<string> => {
  const messages = [
    {
      role: 'system' as const,
      content: 'You are a cautious technical market analyst. Provide conditional LONG, SHORT, or NO TRADE setups from supplied data, with explicit risk controls and uncertainty. Never provide personalized financial advice, guarantees, or leverage recommendations.',
    },
    { role: 'user' as const, content: prompt },
  ];

  if (provider === 'fetch') return requestVertexCompletion(messages, environment);

  // Keep the Node-only OpenAI/Google client out of the Cloudflare execution
  // path. Vercel loads this adapter only when provider === 'node'.
  const { getGemini } = await import('./_ai.ts');
  const gemini = await getGemini(environment);
  const providerResponse = await gemini.chat.completions.create({
    model: 'google/gemini-3.1-pro-preview',
    messages,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    max_completion_tokens: 4_096,
    reasoning_effort: 'low',
  });
  const content = providerResponse.choices[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('The AI provider returned an incomplete response.');
  return content;
};

export const runAIAnalysis = async (
  value: unknown,
  environment: ServerEnvironment,
  provider: ProviderKind = 'node',
): Promise<AIAnalysis> => {
  if (!isConfigured(environment)) {
    throw new AnalysisError(503, 'Gemini trading analysis is not configured on this deployment yet.');
  }
  if (!isValidRequest(value)) {
    throw new AnalysisError(400, 'The supplied market data is incomplete or invalid.');
  }

  try {
    const content = await requestProviderContent(buildPrompt(value), environment, provider);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new AnalysisError(502, 'The AI provider returned invalid market brief data.');
    }
    if (!validateProviderAnalysis(parsed)) {
      throw new AnalysisError(502, 'The AI provider returned an invalid market brief.');
    }
    return {
      ...parsed,
      dataAsOf: value.dataAsOf,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof AnalysisError) throw error;
    console.error('Gemini analysis request failed:', error instanceof Error ? error.message : 'Unknown provider error');
    throw new AnalysisError(502, 'The AI market brief is temporarily unavailable.');
  }
};
