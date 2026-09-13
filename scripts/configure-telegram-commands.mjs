import { pathToFileURL } from 'node:url';

export const telegramCommands = [
  { command: 'ai_analysis', description: 'Choose an analysis horizon' },
  { command: 'short_term_trade', description: 'Short-term trade: 6 hours to 3 days' },
  { command: 'swing_trade', description: 'Swing trade: 3 days to 4 weeks' },
  { command: 'long_term_trade', description: 'Long-term trade: 1 to 12+ months' },
  { command: 'help', description: 'Show BlockLens bot commands' },
];

export const configureTelegramCommands = async ({
  token = process.env.TELEGRAM_BOT_TOKEN?.trim(),
  request = fetch,
} = {}) => {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await request(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: telegramCommands }),
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body.description || 'Telegram setMyCommands failed.');
    }
    return telegramCommands.length;
  } finally {
    clearTimeout(timeout);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ commands: telegramCommands }, null, 2));
  } else {
    configureTelegramCommands()
      .then((count) => console.log(`Configured ${count} Telegram bot commands.`))
      .catch((error) => {
        console.error(error instanceof Error ? error.message : 'Telegram command setup failed.');
        process.exitCode = 1;
      });
  }
}
