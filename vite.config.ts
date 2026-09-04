import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import analyzeHandler from './api/analyze.ts';
import telegramCoinsHandler from './api/telegram/coins.ts';
import telegramWebhookHandler from './api/telegram/webhook.ts';

class LocalApiResponse {
  constructor(private readonly response: ServerResponse) {}

  status(code: number) {
    this.response.statusCode = code;
    return this;
  }

  json(body: unknown) {
    if (!this.response.writableEnded) this.response.end(JSON.stringify(body));
  }

  setHeader(name: string, value: string) {
    this.response.setHeader(name, value);
  }
}

const localAnalyzeApi = (): Plugin => ({
  name: 'blocklens-local-analysis-api',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/api/analyze', (request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      request.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > 1_000_000) {
          response.statusCode = 413;
          response.end(JSON.stringify({ error: 'The analysis request is too large.' }));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => {
        if (response.writableEnded) return;
        const body = Buffer.concat(chunks).toString('utf8');
        void analyzeHandler(
          { method: request.method, body, headers: request.headers },
          new LocalApiResponse(response),
        ).catch(() => {
          if (!response.writableEnded) {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: 'The local analysis endpoint failed.' }));
          }
        });
      });
    });
  },
});

const localTelegramApi = (): Plugin => ({
  name: 'blocklens-local-telegram-api',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/api/telegram/coins', (request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      void telegramCoinsHandler(
        { method: request.method, query: Object.fromEntries(url.searchParams.entries()) },
        new LocalApiResponse(response),
      ).catch(() => {
        if (!response.writableEnded) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: 'The local Telegram coin endpoint failed.' }));
        }
      });
    });

    server.middlewares.use('/api/telegram/webhook', (request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      request.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > 1_000_000) {
          response.statusCode = 413;
          response.end(JSON.stringify({ error: 'The Telegram update is too large.' }));
          request.destroy();
          return;
        }
        chunks.push(chunk);
      });
      request.on('end', () => {
        if (response.writableEnded) return;
        const body = Buffer.concat(chunks).toString('utf8');
        void telegramWebhookHandler(
          { method: request.method, body, headers: request.headers },
          new LocalApiResponse(response),
        ).catch(() => {
          if (!response.writableEnded) {
            response.statusCode = 500;
            response.end(JSON.stringify({ error: 'The local Telegram webhook failed.' }));
          }
        });
      });
    });
  },
});

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  process.env.GOOGLE_CLOUD_PROJECT = environment.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = environment.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  process.env.COINGECKO_API_KEY = environment.COINGECKO_API_KEY || process.env.COINGECKO_API_KEY;
  process.env.COINGECKO_API_PLAN = environment.COINGECKO_API_PLAN || process.env.COINGECKO_API_PLAN;
  process.env.TELEGRAM_BOT_TOKEN = environment.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_WEBHOOK_SECRET = environment.TELEGRAM_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET;

  return {
    plugins: [react(), localAnalyzeApi(), localTelegramApi()],
    server: {
      host: '127.0.0.1',
    },
    build: {
      sourcemap: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/setupTests.ts',
      css: true,
    },
  };
});
