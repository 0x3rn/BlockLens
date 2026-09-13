import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerEnvironment } from '../_env.ts';
import { consumeAnalysisQuota } from '../_analysis-access.ts';
import { buildAnalysisRequest, fetchTopCoins } from '../_market.ts';
import { runAIAnalysis } from '../_analysis.ts';
import type { AIAnalysis, Coin } from '../../src/types/crypto.ts';
import { processTelegramUpdate } from './webhook.ts';
import { answerCallbackQuery, editMessageText, sendMessage } from './_telegram.ts';

vi.mock('../_market.ts', () => ({ buildAnalysisRequest: vi.fn(), fetchTopCoins: vi.fn() }));
vi.mock('../_analysis-access.ts', () => ({ consumeAnalysisQuota: vi.fn() }));
vi.mock('../_rate-limit.ts', () => ({
  acquireAnalysisSlot: vi.fn(() => vi.fn()),
  isRateLimited: vi.fn(() => false),
}));
vi.mock('../_analysis.ts', () => ({
  isAIAnalysisConfigured: vi.fn(() => true),
  normalizeAIAnalysisRequest: vi.fn((input) => input),
  runAIAnalysis: vi.fn(),
}));
vi.mock('./_telegram.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./_telegram.ts')>(),
  answerCallbackQuery: vi.fn(),
  editMessageText: vi.fn(),
  sendMessage: vi.fn(),
}));

const environment = { TELEGRAM_BOT_TOKEN: 'test-token' } as ServerEnvironment;
const coin = (overrides: Partial<Coin> = {}): Coin => ({
  id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: '',
  current_price: 60_000, market_cap: 1_000_000_000, market_cap_rank: 1,
  total_volume: 100_000_000, high_24h: 61_000, low_24h: 59_000,
  price_change_percentage_24h: 1.5, ...overrides,
});
const analysis: AIAnalysis = {
  mode: 'long-term', headline: 'Momentum is constructive',
  summary: 'Closed candles show improving momentum.', stance: 'bullish',
  confidence: 67, risk: 'high', timeframe: '1–12+ months',
  supportLevels: ['$58,000'], resistanceLevels: ['$64,000'],
  tradeSetup: {
    signal: 'long', rationale: 'Price is holding above support.',
    entryZone: '$59,000–$60,000', stopLoss: '$56,000',
    takeProfitLevels: ['$64,000'], riskReward: '1:2',
    invalidation: 'A weekly close below $56,000', positionRisk: 'Use a small allocation.',
  },
  scenarios: [
    { label: 'Bullish', trigger: 'Breakout', target: '$68,000', invalidatedBy: 'Below $60,000' },
    { label: 'Base', trigger: 'Range', target: '$64,000', invalidatedBy: 'Leaves range' },
    { label: 'Bearish', trigger: 'Breakdown', target: '$54,000', invalidatedBy: 'Reclaims $60,000' },
  ],
  methodology: 'Closed spot candles plus verified current catalysts.',
  research: {
    status: 'grounded',
    coinCatalysts: [{
      title: 'Protocol upgrade scheduled', status: 'confirmed', eventDate: '2026-09-20',
      window: '30d', conditionalEffect: 'bullish', mechanism: 'May improve sentiment.',
    }],
    macroCatalysts: [],
    sources: [{ title: 'Verified project announcement', url: 'https://example.com/announcement' }],
    note: 'Current catalysts were checked with Google Search grounding.',
  },
  dataAsOf: '2026-09-13T09:00:00.000Z', generatedAt: '2026-09-13T09:01:00.000Z',
};
const messageUpdate = (text: string) => ({
  update_id: 1, message: { message_id: 10, chat: { id: 20, type: 'private' }, text },
});
const callbackUpdate = (data: string) => ({
  update_id: 2,
  callback_query: {
    id: 'callback-1', from: { id: 30 }, data,
    message: { message_id: 10, chat: { id: 20, type: 'private' } },
  },
});

describe('Telegram AI analysis commands', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows all three horizons from the generic command', async () => {
    await processTelegramUpdate(messageUpdate('/ai_analysis'), environment);
    expect(sendMessage).toHaveBeenCalledWith(
      20, expect.stringContaining('Choose a trading horizon'), environment,
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          [expect.objectContaining({ callback_data: 'ai:mode:short' })],
          [expect.objectContaining({ callback_data: 'ai:mode:swing' })],
          [expect.objectContaining({ callback_data: 'ai:mode:long' })],
        ]),
      }),
    );
    expect(fetchTopCoins).not.toHaveBeenCalled();
  });

  it('opens short-term selection and keeps callback data within Telegram limits', async () => {
    vi.mocked(fetchTopCoins).mockResolvedValue([
      coin({ id: 'a-coin-id-that-is-intentionally-longer-than-telegram-callback-data-should-embed-directly' }),
      coin({ id: 'ethereum', name: 'Ethereum', symbol: 'eth', market_cap_rank: 2 }),
    ]);
    await processTelegramUpdate(messageUpdate('/short_term_trade@BlockLensBot'), environment);
    const keyboard = vi.mocked(sendMessage).mock.calls[0][3];
    const callbacks = keyboard?.inline_keyboard.flat()
      .map((button) => button.callback_data).filter((value): value is string => Boolean(value)) ?? [];
    expect(callbacks).toContain('ai:coin:short:0:0');
    expect(callbacks.every((value) => value.length <= 64)).toBe(true);
    expect(vi.mocked(sendMessage).mock.calls[0][1]).toContain('Short-term AI analysis');
  });

  it('preserves the selected horizon while paging', async () => {
    vi.mocked(fetchTopCoins).mockResolvedValue(Array.from({ length: 13 }, (_, index) => coin({
      id: `coin-${index}`, name: `Coin ${index}`, symbol: `c${index}`, market_cap_rank: index + 1,
    })));
    await processTelegramUpdate(callbackUpdate('ai:page:long:1'), environment);
    expect(answerCallbackQuery).toHaveBeenCalledWith('callback-1', environment);
    expect(editMessageText).toHaveBeenCalledWith(
      20, 10, expect.stringContaining('Long-term AI analysis'), environment,
      expect.objectContaining({
        inline_keyboard: expect.arrayContaining([
          expect.arrayContaining([expect.objectContaining({ callback_data: 'ai:coin:long:1:0' })]),
        ]),
      }),
    );
  });

  it('runs long-term analysis and includes grounded research with source links', async () => {
    vi.mocked(fetchTopCoins).mockResolvedValue([coin()]);
    vi.mocked(buildAnalysisRequest).mockResolvedValue({
      coinId: 'bitcoin', coinName: 'Bitcoin', currency: 'usd', price: 60_000,
      change24h: 1.5, mode: 'long-term', candleSeries: [], chartData7d: [],
      chartData30d: [], chartData1y: [], dataAsOf: analysis.dataAsOf,
    });
    vi.mocked(runAIAnalysis).mockResolvedValue(analysis);
    await processTelegramUpdate(callbackUpdate('ai:coin:long:0:0'), environment);
    expect(buildAnalysisRequest).toHaveBeenCalledWith('bitcoin', 'usd', environment, 'long-term');
    expect(consumeAnalysisQuota).toHaveBeenCalledWith('telegram:30', environment);
    expect(runAIAnalysis).toHaveBeenCalledWith(expect.objectContaining({ mode: 'long-term' }), environment, 'node');
    const finalText = vi.mocked(editMessageText).mock.calls.at(-1)?.[2] ?? '';
    expect(finalText).toContain('Long-term AI analysis');
    expect(finalText).toContain('Position thesis');
    expect(finalText).toContain('Google Search-grounded');
    expect(finalText).toContain('Protocol upgrade scheduled');
    expect(finalText).toContain('<a href="https://example.com/announcement">Verified project announcement</a>');
    expect(vi.mocked(editMessageText).mock.calls.at(-1)?.[4]).toEqual(expect.objectContaining({
      inline_keyboard: expect.arrayContaining([
        [expect.objectContaining({ callback_data: 'ai:page:long:0' })],
      ]),
    }));
  });

  it('ignores malformed or out-of-range coin callbacks', async () => {
    await processTelegramUpdate(callbackUpdate('ai:coin:short:0:12'), environment);
    await processTelegramUpdate(callbackUpdate('ai:coin:unknown:0:0'), environment);
    await processTelegramUpdate(callbackUpdate('ai:coin:swing:-1:0'), environment);
    expect(answerCallbackQuery).toHaveBeenCalledTimes(3);
    expect(fetchTopCoins).not.toHaveBeenCalled();
    expect(buildAnalysisRequest).not.toHaveBeenCalled();
  });

  it('lists direct horizon commands in help', async () => {
    await processTelegramUpdate(messageUpdate('/help'), environment);
    const text = vi.mocked(sendMessage).mock.calls[0][1];
    expect(text).toContain('/short_term_trade');
    expect(text).toContain('/swing_trade');
    expect(text).toContain('/long_term_trade');
  });
});
