// import { getDeepSeek } from './_ai.ts';
import { getGemini } from './_ai.ts';

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type RequestLike = {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
};

type ChartPoint = { timestamp: number; price: number; volume?: number };

const rateWindowMs = 60_000;
const requestLimit = 8;
const requestLog = new Map<string, number[]>();

const samplePoints = (points: ChartPoint[], count: number) => {
  if (points.length <= count) return points;
  const step = (points.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => points[Math.round(index * step)]);
};

const isChart = (value: unknown): value is ChartPoint[] => (
  Array.isArray(value)
  && value.length <= 2_000
  && value.every((point) => (
    point
    && typeof point === 'object'
    && Number.isFinite((point as ChartPoint).timestamp)
    && Number.isFinite((point as ChartPoint).price)
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

const readClientIp = (request: RequestLike) => {
  const forwarded = request.headers['x-forwarded-for'];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || 'anonymous';
};

const isRateLimited = (ip: string) => {
  const now = Date.now();
  const recent = (requestLog.get(ip) ?? []).filter((timestamp) => now - timestamp < rateWindowMs);
  recent.push(now);
  requestLog.set(ip, recent);
  if (requestLog.size > 5_000) {
    for (const [key, timestamps] of requestLog) {
      if (timestamps.every((timestamp) => now - timestamp >= rateWindowMs)) requestLog.delete(key);
    }
  }
  return recent.length > requestLimit;
};

export default async function handler(request: RequestLike, response: ResponseLike) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Only POST requests are accepted.' });
  }

  const ip = readClientIp(request);
  if (isRateLimited(ip)) {
    return response.status(429).json({ error: 'Too many analysis requests. Please wait a minute and retry.' });
  }

  if (!process.env.GOOGLE_CLOUD_PROJECT || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return response.status(503).json({
      error: 'Gemini trading analysis is not configured on this deployment yet.',
    });
  }

  let body: unknown;
  try {
    body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
  } catch {
    return response.status(400).json({ error: 'The request body is not valid JSON.' });
  }
  if (!body || typeof body !== 'object') {
    return response.status(400).json({ error: 'Invalid request body.' });
  }

  const input = body as Record<string, unknown>;
  if (
    typeof input.coinId !== 'string'
    || !/^[a-z0-9-]{1,100}$/.test(input.coinId)
    || typeof input.coinName !== 'string'
    || input.coinName.length < 1
    || input.coinName.length > 80
    || typeof input.currency !== 'string'
    || !['usd', 'eur', 'gbp', 'ngn'].includes(input.currency)
    || !Number.isFinite(input.price)
    || !Number.isFinite(input.change24h)
    || !isChart(input.chartData7d)
    || input.chartData7d.length < 2
    || !isChart(input.chartData30d)
    || input.chartData30d.length < 2
    || !isChart(input.chartData1y)
    || input.chartData1y.length < 2
    || typeof input.dataAsOf !== 'string'
    || Number.isNaN(Date.parse(input.dataAsOf))
  ) {
    return response.status(400).json({ error: 'The supplied market data is incomplete or invalid.' });
  }

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

  const prompt = `Create an educational market brief from the supplied price and volume history.

Rules:
- Provide one conditional technical setup: LONG, SHORT, or NO TRADE. Choose NO TRADE whenever the supplied data does not show a defensible edge.
- The setup must include a price-based entry zone, stop loss, take-profit levels, risk/reward estimate, invalidation condition, and conservative position-risk note.
- Never promise profit, imply certainty, recommend leverage, or present the setup as personalized financial advice.
- Present uncertainty and three conditional scenarios: Bullish, Base, and Bearish.
- Use only the supplied data. Do not invent news, sentiment, catalysts, indicators, or exact precision unsupported by the sample.
- Support and resistance values must be expressed as human-readable price strings in ${input.currency.toString().toUpperCase()}.
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

  try {
    // const deepseek = getDeepSeek();
    const gemini = await getGemini();

    /* const providerResponse = await deepseek.chat.completions.create({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: 'You are a cautious technical market analyst.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 1_200,
    }); */

    const providerResponse = await gemini.chat.completions.create({
      model: 'google/gemini-3.1-pro-preview',
      messages: [
        {
          role: 'system',
          content: 'You are a cautious technical market analyst. Provide conditional LONG, SHORT, or NO TRADE setups from supplied data, with explicit risk controls and uncertainty. Never provide personalized financial advice, guarantees, or leverage recommendations.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_completion_tokens: 4_096,
      reasoning_effort: 'low',
    });

    const content = providerResponse.choices[0]?.message?.content;
    if (typeof content !== 'string') {
      return response.status(502).json({ error: 'The AI provider returned an incomplete response.' });
    }

    const analysis = JSON.parse(content);
    const tradeSetup = analysis?.tradeSetup;
    if (
      !isText(analysis.headline, 180)
      || !isText(analysis.summary, 1_500)
      || !['bullish', 'neutral', 'bearish'].includes(analysis.stance)
      || !Number.isInteger(analysis.confidence)
      || analysis.confidence < 0
      || analysis.confidence > 100
      || !['low', 'medium', 'high'].includes(analysis.risk)
      || !isText(analysis.timeframe, 120)
      || !isTextList(analysis.supportLevels)
      || !isTextList(analysis.resistanceLevels)
      || !tradeSetup
      || typeof tradeSetup !== 'object'
      || !['long', 'short', 'no-trade'].includes(tradeSetup.signal)
      || !isText(tradeSetup.rationale, 800)
      || !isText(tradeSetup.entryZone, 180)
      || !isText(tradeSetup.stopLoss, 180)
      || !isTextList(tradeSetup.takeProfitLevels)
      || !isText(tradeSetup.riskReward, 180)
      || !isText(tradeSetup.invalidation, 500)
      || !isText(tradeSetup.positionRisk, 500)
      || !Array.isArray(analysis.scenarios)
      || analysis.scenarios.length !== 3
      || !isScenario(analysis.scenarios[0], 'Bullish')
      || !isScenario(analysis.scenarios[1], 'Base')
      || !isScenario(analysis.scenarios[2], 'Bearish')
      || !isText(analysis.methodology, 1_500)
    ) {
      return response.status(502).json({ error: 'The AI provider returned an invalid market brief.' });
    }

    return response.status(200).json({
      ...analysis,
      dataAsOf: input.dataAsOf,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      'Gemini analysis request failed:',
      error instanceof Error ? error.message : 'Unknown provider error',
    );
    return response.status(502).json({ error: 'The AI market brief is temporarily unavailable.' });
  }
}
