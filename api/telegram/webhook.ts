import { buildAnalysisRequest, fetchTopCoins } from '../_market.ts';
import { processEnvironment, type ServerEnvironment } from '../_env.ts';
import { consumeAnalysisQuota } from '../_analysis-access.ts';
import { acquireAnalysisSlot, isRateLimited } from '../_rate-limit.ts';
import { isAIAnalysisConfigured, normalizeAIAnalysisRequest, runAIAnalysis, type ProviderKind } from '../_analysis.ts';
import type { AIAnalysis, AIAnalysisRequest, Coin } from '../../src/types/crypto.ts';
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

const coinListKeyboard = (coins: Coin[], page: number): InlineKeyboardMarkup => {
  const view = coinsForPage(coins, page);
  const rows = [] as { text: string; callback_data: string }[][];
  for (let index = 0; index < view.items.length; index += 2) {
    const row = view.items.slice(index, index + 2).map((coin) => ({
      text: coinButtonText(coin),
      callback_data: `ai:coin:${coin.id}`,
    }));
    rows.push(row);
  }

  const navigation = [] as { text: string; callback_data: string }[];
  if (view.page > 0) navigation.push({ text: '‹ Previous', callback_data: `ai:page:${view.page - 1}` });
  if (view.page < view.pageCount - 1) navigation.push({ text: 'Next ›', callback_data: `ai:page:${view.page + 1}` });
  if (navigation.length > 0) rows.push(navigation);
  return { inline_keyboard: rows };
};

const coinListText = (page: number, total: number) => {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  return [
    '<b>AI trading analysis</b>',
    `Choose a coin · ${safePage + 1} of ${pageCount}`,
    'The brief uses the latest available market snapshot.',
  ].join('\n');
};

const backToCoinsKeyboard = (page = 0): InlineKeyboardMarkup => ({
  inline_keyboard: [[{ text: 'Back to coins', callback_data: `ai:page:${page}` }]],
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
  page = 0,
  environment: ServerEnvironment,
  message?: TelegramMessage,
) => {
  const coins = await fetchTopCoins(currency, environment);
  const view = coinsForPage(coins, page);
  const text = coinListText(view.page, coins.length);
  const keyboard = coinListKeyboard(coins, view.page);
  if (message) {
    await editMessageText(chatId, message.message_id, text, environment, keyboard);
  } else {
    await sendMessage(chatId, text, environment, keyboard);
  }
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
  const signal = setup.signal === 'no-trade' ? 'NO TRADE' : setup.signal.toUpperCase();
  const lines = [
    `<b>${escapeHtml(coin.name)} · AI trading analysis</b>`,
    `<b>Signal:</b> ${escapeHtml(signal)} · <b>Confidence:</b> ${analysis.confidence}%`,
    `<b>Bias:</b> ${escapeHtml(analysis.stance)} · <b>Risk:</b> ${escapeHtml(analysis.risk)}`,
    '',
    `<b>Summary</b>\n${escapeHtml(analysis.summary)}`,
    '',
    `<b>Conditional setup</b>`,
    `<b>Entry:</b> ${escapeHtml(setup.entryZone)}`,
    `<b>Stop loss:</b> ${escapeHtml(setup.stopLoss)}`,
    `<b>Take profit:</b> ${escapeHtml(setup.takeProfitLevels.join(' · '))}`,
    `<b>Risk / reward:</b> ${escapeHtml(setup.riskReward)}`,
    `<b>Why:</b> ${escapeHtml(setup.rationale)}`,
    `<b>Invalidation:</b> ${escapeHtml(setup.invalidation)}`,
    '',
    `<b>Support:</b> ${escapeHtml(analysis.supportLevels.join(' · '))}`,
    `<b>Resistance:</b> ${escapeHtml(analysis.resistanceLevels.join(' · '))}`,
    '',
    '<b>Scenarios</b>',
    ...analysis.scenarios.map((scenario) => (
      `<b>${escapeHtml(scenario.label)}:</b> ${escapeHtml(scenario.trigger)} · Target ${escapeHtml(scenario.target)} · Invalidated by ${escapeHtml(scenario.invalidatedBy)}`
    )),
    '',
    `<b>Methodology:</b> ${escapeHtml(analysis.methodology)}`,
    '',
    '<i>Educational market research, not financial advice.</i>',
  ];
  return chunkTelegramHtml(lines);
};

const handleCoinSelection = async (
  callback: TelegramCallbackQuery,
  coinId: string,
  environment: ServerEnvironment,
  provider: ProviderKind,
) => {
  const message = callback.message;
  if (!message) return;
  const chatId = message.chat.id;
  let coins: Coin[];
  try {
    coins = await fetchTopCoins(currency, environment);
  } catch (error) {
    console.error('Telegram coin list failed:', error instanceof Error ? error.message : 'Unknown market-data error');
    await editMessageText(
      chatId,
      message.message_id,
      'The live coin list is unavailable right now. Please try again shortly.',
      environment,
      backToCoinsKeyboard(),
    );
    return;
  }
  const coin = coins.find((item) => item.id === coinId);
  if (!coin) {
    await editMessageText(chatId, message.message_id, 'That coin is no longer in the current list.', environment, backToCoinsKeyboard());
    return;
  }

  await editMessageText(
    chatId,
    message.message_id,
    `<b>${escapeHtml(coin.name)} · AI trading analysis</b>\nGenerating the latest brief…`,
    environment,
    backToCoinsKeyboard(),
  );

  try {
    const payload = await buildAnalysisRequest(coin.id, currency, environment);
    const analysis = await generateAnalysis(payload, callback.from.id, environment, provider);
    const chunks = formatAnalysis(coin, analysis);
    await editMessageText(chatId, message.message_id, chunks[0], environment, backToCoinsKeyboard());
    for (const chunk of chunks.slice(1)) await sendMessage(chatId, chunk, environment, backToCoinsKeyboard());
  } catch (error) {
    console.error('Telegram AI analysis failed:', error instanceof Error ? error.message : 'Unknown error');
    await editMessageText(
      chatId,
      message.message_id,
      'The AI brief could not be generated right now. Please try again shortly.',
      environment,
      backToCoinsKeyboard(),
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
  if (data.startsWith('ai:page:')) {
    const page = Number(data.slice('ai:page:'.length));
    if (!Number.isInteger(page) || page < 0 || !callback.message) return;
    try {
      await sendCoinPicker(callback.message.chat.id, page, environment, callback.message);
    } catch (error) {
      console.error('Telegram coin list failed:', error instanceof Error ? error.message : 'Unknown market-data error');
      await editMessageText(
        callback.message.chat.id,
        callback.message.message_id,
        'The live coin list is unavailable right now. Please try again shortly.',
        environment,
        backToCoinsKeyboard(page),
      );
    }
    return;
  }
  if (data.startsWith('ai:coin:')) {
    const coinId = data.slice('ai:coin:'.length);
    if (/^[a-z0-9-]{1,100}$/.test(coinId)) await handleCoinSelection(callback, coinId, environment, provider);
  }
};

const handleMessage = async (message: TelegramMessage, environment: ServerEnvironment) => {
  const text = message.text?.trim().toLowerCase() ?? '';
  const command = text.split(/\s+/)[0]?.split('@')[0];
  // Telegram command menus only allow letters, numbers, and underscores. Keep
  // the original hyphenated command working for users who type it manually,
  // and accept the menu-safe underscore alias as well.
  if (command !== '/ai-analysis' && command !== '/ai_analysis' && command !== '/start') return;
  try {
    await sendCoinPicker(message.chat.id, 0, environment);
  } catch (error) {
    console.error('Telegram coin list failed:', error instanceof Error ? error.message : 'Unknown market-data error');
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
