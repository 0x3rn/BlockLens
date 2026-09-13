import { buildAnalysisRequest, fetchTopCoins } from '../_market.ts';
import { processEnvironment, type ServerEnvironment } from '../_env.ts';
import { consumeAnalysisQuota } from '../_analysis-access.ts';
import { acquireAnalysisSlot, isRateLimited } from '../_rate-limit.ts';
import { isAIAnalysisConfigured, normalizeAIAnalysisRequest, runAIAnalysis, type ProviderKind } from '../_analysis.ts';
import { analysisModeDefinitions } from '../../src/config/analysisModes.ts';
import type { AIAnalysis, AIAnalysisMode, AIAnalysisRequest, Coin } from '../../src/types/crypto.ts';
import {
  answerCallbackQuery,
  chunkTelegramHtml,
  editMessageText,
  escapeHtml,
  sendMessage,
} from './_telegram.ts';
import type {
  InlineKeyboardMarkup,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
} from './_telegram.ts';

export const maxDuration = 60;

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

const PAGE_SIZE = 12;
const currency = 'usd' as const;
type TelegramModeCode = 'short' | 'swing' | 'long';

const modeCodes: Record<AIAnalysisMode, TelegramModeCode> = {
  'short-term': 'short',
  swing: 'swing',
  'long-term': 'long',
};

const modesByCode: Record<TelegramModeCode, AIAnalysisMode> = {
  short: 'short-term',
  swing: 'swing',
  long: 'long-term',
};

const parseModeCode = (value: string): AIAnalysisMode | null => modesByCode[value as TelegramModeCode] ?? null;

const modePickerKeyboard = (): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [{ text: '⚡ Short-term · 6h–3d', callback_data: 'ai:mode:short' }],
    [{ text: '↗ Swing · 3d–4w', callback_data: 'ai:mode:swing' }],
    [{ text: '◉ Long-term · 1–12m+', callback_data: 'ai:mode:long' }],
  ],
});

const modePickerText = [
  '<b>AI market analysis</b>',
  'Choose a trading horizon. Each mode uses different closed candles and searches for catalysts relevant to that period.',
].join('\n');

const coinsForPage = (coins: Coin[], page: number) => {
  const pageCount = Math.max(1, Math.ceil(coins.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  return {
    page: safePage,
    pageCount,
    items: coins.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
  };
};

const coinButtonText = (coin: Coin) => {
  const label = `${coin.name} (${coin.symbol.toUpperCase()})`;
  return `#${coin.market_cap_rank ?? '?'} ${label}`.slice(0, 62);
};

const coinListKeyboard = (coins: Coin[], page: number, mode: AIAnalysisMode): InlineKeyboardMarkup => {
  const view = coinsForPage(coins, page);
  const modeCode = modeCodes[mode];
  const rows = [] as { text: string; callback_data: string }[][];
  for (let index = 0; index < view.items.length; index += 2) {
    const row = view.items.slice(index, index + 2).map((coin, rowOffset) => ({
      text: coinButtonText(coin),
      callback_data: `ai:coin:${modeCode}:${view.page}:${index + rowOffset}`,
    }));
    rows.push(row);
  }

  const navigation = [] as { text: string; callback_data: string }[];
  if (view.page > 0) navigation.push({ text: '‹ Previous', callback_data: `ai:page:${modeCode}:${view.page - 1}` });
  if (view.page < view.pageCount - 1) navigation.push({ text: 'Next ›', callback_data: `ai:page:${modeCode}:${view.page + 1}` });
  if (navigation.length > 0) rows.push(navigation);
  rows.push([{ text: 'Change horizon', callback_data: 'ai:modes' }]);
  return { inline_keyboard: rows };
};

const coinListText = (page: number, total: number, mode: AIAnalysisMode) => {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const definition = analysisModeDefinitions[mode];
  return [
    `<b>${escapeHtml(definition.label)} AI analysis · ${escapeHtml(definition.holdingPeriod)}</b>`,
    `Choose a coin · ${safePage + 1} of ${pageCount}`,
    escapeHtml(definition.description),
  ].join('\n');
};

const backToCoinsKeyboard = (mode: AIAnalysisMode, page = 0): InlineKeyboardMarkup => ({
  inline_keyboard: [[{ text: 'Back to coins', callback_data: `ai:page:${modeCodes[mode]}:${page}` }], [{ text: 'Change horizon', callback_data: 'ai:modes' }]],
});

const readBody = (request: RequestLike): unknown => {
  if (typeof request.body !== 'string') return request.body;
  try {
    return JSON.parse(request.body);
  } catch {
    return null;
  }
};

const getHeader = (request: RequestLike, name: string): string | undefined => {
  const value = request.headers[name] ?? request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

const sendCoinPicker = async (
  chatId: number,
  mode: AIAnalysisMode,
  page = 0,
  environment: ServerEnvironment,
  message?: TelegramMessage,
) => {
  const coins = await fetchTopCoins(currency, environment);
  const view = coinsForPage(coins, page);
  const text = coinListText(view.page, coins.length, mode);
  const keyboard = coinListKeyboard(coins, view.page, mode);
  if (message) {
    await editMessageText(chatId, message.message_id, text, environment, keyboard);
  } else {
    await sendMessage(chatId, text, environment, keyboard);
  }
};

const sendModePicker = async (chatId: number, environment: ServerEnvironment, message?: TelegramMessage) => {
  if (message) await editMessageText(chatId, message.message_id, modePickerText, environment, modePickerKeyboard());
  else await sendMessage(chatId, modePickerText, environment, modePickerKeyboard());
};

const generateAnalysis = async (
  payload: AIAnalysisRequest,
  telegramUserId: number,
  environment: ServerEnvironment,
  provider: ProviderKind,
): Promise<AIAnalysis> => {
  if (isRateLimited(`telegram:${telegramUserId}`)) {
    throw new Error('Too many analysis requests. Please wait a minute and try again.');
  }
  if (!isAIAnalysisConfigured(environment)) {
    throw new Error('Gemini trading analysis is not configured on this deployment yet.');
  }
  const input = normalizeAIAnalysisRequest(payload);
  if (!input) throw new Error('The supplied market data is incomplete or invalid.');
  const releaseSlot = acquireAnalysisSlot();
  if (!releaseSlot) throw new Error('AI analysis is busy. Please retry shortly.');
  try {
    await consumeAnalysisQuota(`telegram:${telegramUserId}`, environment);
    return await runAIAnalysis(input, environment, provider);
  } finally {
    releaseSlot();
  }
};

const formatAnalysis = (coin: Coin, analysis: AIAnalysis) => {
  const setup = analysis.tradeSetup;
  const definition = analysisModeDefinitions[analysis.mode];
  const isLongTerm = analysis.mode === 'long-term';
  const signal = setup.signal === 'no-trade' ? 'NO TRADE' : setup.signal.toUpperCase();
  const catalysts = [...analysis.research.coinCatalysts, ...analysis.research.macroCatalysts];
  const lines = [
    `<b>${escapeHtml(coin.name)} · ${escapeHtml(definition.label)} AI analysis</b>`,
    `<b>Horizon:</b> ${escapeHtml(definition.holdingPeriod)}`,
    `<b>Signal:</b> ${escapeHtml(signal)} · <b>Confidence:</b> ${analysis.confidence}%`,
    `<b>Bias:</b> ${escapeHtml(analysis.stance)} · <b>Risk:</b> ${escapeHtml(analysis.risk)}`,
    '',
    `<b>${escapeHtml(analysis.headline)}</b>\n${escapeHtml(analysis.summary)}`,
    '',
    `<b>${isLongTerm ? 'Position thesis' : 'Conditional setup'}</b>`,
    `<b>${isLongTerm ? 'Accumulation zone' : 'Entry'}:</b> ${escapeHtml(setup.entryZone)}`,
    `<b>${isLongTerm ? 'Thesis invalidation' : 'Stop loss'}:</b> ${escapeHtml(setup.stopLoss)}`,
    `<b>${isLongTerm ? 'Review objectives' : 'Take profit'}:</b> ${escapeHtml(setup.takeProfitLevels.join(' · '))}`,
    `<b>Risk / reward:</b> ${escapeHtml(setup.riskReward)}`,
    `<b>Why:</b> ${escapeHtml(setup.rationale)}`,
    `<b>Invalidation:</b> ${escapeHtml(setup.invalidation)}`,
    `<b>${isLongTerm ? 'Allocation risk' : 'Position risk'}:</b> ${escapeHtml(setup.positionRisk)}`,
    '',
    `<b>Support:</b> ${escapeHtml(analysis.supportLevels.join(' · '))}`,
    `<b>Resistance:</b> ${escapeHtml(analysis.resistanceLevels.join(' · '))}`,
    '',
    '<b>Scenarios</b>',
    ...analysis.scenarios.map((scenario) => (
      `<b>${escapeHtml(scenario.label)}:</b> ${escapeHtml(scenario.trigger)} · Target ${escapeHtml(scenario.target)} · Invalidated by ${escapeHtml(scenario.invalidatedBy)}`
    )),
    '',
    `<b>Market research:</b> ${analysis.research.status === 'grounded' ? 'Google Search-grounded' : 'Technical-only'}`,
    escapeHtml(analysis.research.note),
    ...catalysts.map((catalyst) => `<b>${escapeHtml(catalyst.title)}</b> · ${escapeHtml(catalyst.eventDate)} · ${escapeHtml(catalyst.conditionalEffect)}\n${escapeHtml(catalyst.mechanism)}`),
    ...(analysis.research.sources.length > 0 ? [
      '',
      '<b>Verified sources</b>',
      ...analysis.research.sources.map((source) => `<a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a>`),
    ] : []),
    '',
    `<b>Methodology:</b> ${escapeHtml(analysis.methodology)}`,
    '',
    '<i>Educational market research, not financial advice.</i>',
  ];
  return chunkTelegramHtml(lines);
};

const handleCoinSelection = async (
  callback: TelegramCallbackQuery,
  coin: Coin,
  mode: AIAnalysisMode,
  page: number,
  environment: ServerEnvironment,
  provider: ProviderKind,
) => {
  const message = callback.message;
  if (!message) return;
  const chatId = message.chat.id;
  await editMessageText(
    chatId,
    message.message_id,
    `<b>${escapeHtml(coin.name)} · ${escapeHtml(analysisModeDefinitions[mode].label)} AI analysis</b>\nLoading closed candles and checking current market catalysts…`,
    environment,
    backToCoinsKeyboard(mode, page),
  );

  try {
    const payload = await buildAnalysisRequest(coin.id, currency, environment, mode);
    const analysis = await generateAnalysis(payload, callback.from.id, environment, provider);
    const chunks = formatAnalysis(coin, analysis);
    await editMessageText(chatId, message.message_id, chunks[0], environment, backToCoinsKeyboard(mode, page));
    for (const chunk of chunks.slice(1)) await sendMessage(chatId, chunk, environment, backToCoinsKeyboard(mode, page));
  } catch (error) {
    console.error('Telegram AI analysis failed:', error instanceof Error ? error.message : 'Unknown error');
    await editMessageText(
      chatId,
      message.message_id,
      'The AI brief could not be generated right now. Please try again shortly.',
      environment,
      backToCoinsKeyboard(mode, page),
    );
  }
};

const handleCallback = async (
  callback: TelegramCallbackQuery,
  environment: ServerEnvironment,
  provider: ProviderKind,
) => {
  // Telegram shows a progress indicator until this is acknowledged.
  try {
    await answerCallbackQuery(callback.id, environment);
  } catch (error) {
    console.warn('Telegram callback acknowledgement failed:', error instanceof Error ? error.message : 'Unknown error');
  }

  const data = callback.data ?? '';
  if (data === 'ai:modes') {
    if (callback.message) await sendModePicker(callback.message.chat.id, environment, callback.message);
    return;
  }
  if (data.startsWith('ai:mode:')) {
    const mode = parseModeCode(data.slice('ai:mode:'.length));
    if (!mode || !callback.message) return;
    try {
      await sendCoinPicker(callback.message.chat.id, mode, 0, environment, callback.message);
    } catch (error) {
      console.error('Telegram coin list failed:', error instanceof Error ? error.message : 'Unknown market-data error');
      await editMessageText(callback.message.chat.id, callback.message.message_id, 'The live coin list is unavailable right now. Please try again shortly.', environment, modePickerKeyboard());
    }
    return;
  }
  if (data.startsWith('ai:page:')) {
    const [modeCode, rawPage, ...extra] = data.slice('ai:page:'.length).split(':');
    const mode = parseModeCode(modeCode);
    const page = Number(rawPage);
    if (!mode || extra.length > 0 || !Number.isInteger(page) || page < 0 || !callback.message) return;
    try {
      await sendCoinPicker(callback.message.chat.id, mode, page, environment, callback.message);
    } catch (error) {
      console.error('Telegram coin list failed:', error instanceof Error ? error.message : 'Unknown market-data error');
      await editMessageText(
        callback.message.chat.id,
        callback.message.message_id,
        'The live coin list is unavailable right now. Please try again shortly.',
        environment,
        backToCoinsKeyboard(mode, page),
      );
    }
    return;
  }
  if (data.startsWith('ai:coin:')) {
    const [modeCode, rawPage, rawIndex, ...extra] = data.slice('ai:coin:'.length).split(':');
    const mode = parseModeCode(modeCode);
    const page = Number(rawPage);
    const index = Number(rawIndex);
    if (!mode || extra.length > 0 || !Number.isInteger(page) || page < 0 || !Number.isInteger(index) || index < 0 || index >= PAGE_SIZE || !callback.message) return;
    try {
      const coins = await fetchTopCoins(currency, environment);
      const coin = coinsForPage(coins, page).items[index];
      if (!coin) {
        await editMessageText(callback.message.chat.id, callback.message.message_id, 'That coin is no longer in the current list.', environment, backToCoinsKeyboard(mode, page));
        return;
      }
      await handleCoinSelection(callback, coin, mode, page, environment, provider);
    } catch (error) {
      console.error('Telegram coin selection failed:', error instanceof Error ? error.message : 'Unknown market-data error');
      await editMessageText(callback.message.chat.id, callback.message.message_id, 'The live coin list is unavailable right now. Please try again shortly.', environment, backToCoinsKeyboard(mode, page));
    }
  }
};

const handleMessage = async (message: TelegramMessage, environment: ServerEnvironment) => {
  const text = message.text?.trim().toLowerCase() ?? '';
  const command = text.split(/\s+/)[0]?.split('@')[0];
  const directModes: Record<string, AIAnalysisMode> = {
    '/short_term_trade': 'short-term',
    '/swing_trade': 'swing',
    '/long_term_trade': 'long-term',
    '/ai_short': 'short-term',
    '/ai_short_term': 'short-term',
    '/ai_swing': 'swing',
    '/ai_long': 'long-term',
    '/ai_long_term': 'long-term',
  };
  if (command === '/help') {
    await sendMessage(message.chat.id, [
      '<b>BlockLens AI commands</b>',
      '/ai_analysis — choose an analysis horizon',
      '/short_term_trade — short-term analysis (6 hours–3 days)',
      '/swing_trade — swing analysis (3 days–4 weeks)',
      '/long_term_trade — long-term analysis (1–12+ months)',
    ].join('\n'), environment);
    return;
  }
  const directMode = directModes[command];
  if (!directMode && command !== '/ai-analysis' && command !== '/ai_analysis' && command !== '/start') return;
  try {
    if (directMode) await sendCoinPicker(message.chat.id, directMode, 0, environment);
    else await sendModePicker(message.chat.id, environment);
  } catch (error) {
    console.error('Telegram analysis menu failed:', error instanceof Error ? error.message : 'Unknown market-data error');
    await sendMessage(
      message.chat.id,
      'The live coin list is unavailable right now. Please try again shortly.',
      environment,
    );
  }
};

export const processTelegramUpdate = async (
  update: TelegramUpdate,
  environment: ServerEnvironment,
  provider: ProviderKind = 'node',
) => {
  if (update.callback_query) await handleCallback(update.callback_query, environment, provider);
  else if (update.message) await handleMessage(update.message, environment);
};

export default async function handler(request: RequestLike, response: ResponseLike) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Only POST requests are accepted.' });
  }

  const environment = processEnvironment();
  const configuredSecret = environment.TELEGRAM_WEBHOOK_SECRET?.trim();
  const providedSecret = getHeader(request, 'x-telegram-bot-api-secret-token');
  if (!configuredSecret || providedSecret !== configuredSecret) {
    return response.status(401).json({ error: 'Invalid webhook credentials.' });
  }
  if (!environment.TELEGRAM_BOT_TOKEN?.trim()) {
    return response.status(503).json({ error: 'The Telegram bot is not configured.' });
  }

  const update = readBody(request);
  if (!update || typeof update !== 'object') {
    return response.status(400).json({ error: 'Invalid Telegram update.' });
  }

  try {
    await processTelegramUpdate(update as TelegramUpdate, environment, 'node');
  } catch (error) {
    console.error('Telegram webhook failed:', error instanceof Error ? error.message : 'Unknown error');
    // Acknowledge the update so Telegram does not retry a user-facing failure.
  }

  return response.status(200).json({ ok: true });
}
