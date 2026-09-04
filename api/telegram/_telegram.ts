import type { ServerEnvironment } from '../_env.ts';

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number; first_name?: string; username?: string };
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

const getBotToken = (environment: ServerEnvironment) => {
  const token = environment.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  return token;
};

export const callTelegram = async <T>(
  method: string,
  payload: Record<string, unknown>,
  environment: ServerEnvironment,
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${getBotToken(environment)}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json() as TelegramApiResponse<T>;
    if (!response.ok || !body.ok) {
      throw new Error(body.description || `Telegram ${method} failed.`);
    }
    return body.result as T;
  } finally {
    clearTimeout(timeout);
  }
};

export const sendMessage = (
  chatId: number,
  text: string,
  environment: ServerEnvironment,
  replyMarkup?: InlineKeyboardMarkup,
) => callTelegram<TelegramMessage>('sendMessage', {
  chat_id: chatId,
  text,
  parse_mode: 'HTML',
  ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
}, environment);

export const editMessageText = (
  chatId: number,
  messageId: number,
  text: string,
  environment: ServerEnvironment,
  replyMarkup?: InlineKeyboardMarkup,
) => callTelegram<TelegramMessage | boolean>('editMessageText', {
  chat_id: chatId,
  message_id: messageId,
  text,
  parse_mode: 'HTML',
  ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
}, environment);

export const answerCallbackQuery = (
  callbackQueryId: string,
  environment: ServerEnvironment,
  text?: string,
) => callTelegram<boolean>('answerCallbackQuery', {
  callback_query_id: callbackQueryId,
  ...(text ? { text } : {}),
}, environment);

export const escapeHtml = (value: unknown): string => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

export const chunkTelegramHtml = (lines: string[], maxLength = 3_800): string[] => {
  const chunks: string[] = [];
  let current = '';
  lines.forEach((line) => {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxLength) {
      current = candidate;
      return;
    }
    if (current) chunks.push(current);
    current = line;
  });
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : ['No analysis was returned.'];
};
