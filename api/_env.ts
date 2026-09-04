export type ServerEnvironment = {
  COINGECKO_API_KEY?: string;
  /** CoinGecko plan used by server-side requests. Defaults to `demo`. */
  COINGECKO_API_PLAN?: string;
  GOOGLE_CLOUD_PROJECT?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
};

export const processEnvironment = (): ServerEnvironment => ({
  COINGECKO_API_KEY: process.env.COINGECKO_API_KEY,
  COINGECKO_API_PLAN: process.env.COINGECKO_API_PLAN,
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
});
