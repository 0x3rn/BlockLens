import { describe, expect, it, vi } from 'vitest';
import { configureTelegramCommands, telegramCommands } from './configure-telegram-commands.mjs';

describe('Telegram command-menu configuration', () => {
  it('defines valid, unique Telegram commands', () => {
    expect(telegramCommands.map(({ command }) => command)).toEqual([
      'ai_analysis', 'short_term_trade', 'swing_trade', 'long_term_trade', 'help',
    ]);
    expect(new Set(telegramCommands.map(({ command }) => command)).size).toBe(telegramCommands.length);
    for (const { command, description } of telegramCommands) {
      expect(command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(description.length).toBeGreaterThan(0);
      expect(description.length).toBeLessThanOrEqual(256);
    }
  });

  it('requires a bot token before making a request', async () => {
    const request = vi.fn();
    await expect(configureTelegramCommands({ token: '', request })).rejects.toThrow('TELEGRAM_BOT_TOKEN is required');
    expect(request).not.toHaveBeenCalled();
  });

  it('posts the complete menu to Telegram', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true, result: true }),
    });
    await expect(configureTelegramCommands({ token: 'secret-test-token', request })).resolves.toBe(5);
    expect(request).toHaveBeenCalledWith(
      'https://api.telegram.org/botsecret-test-token/setMyCommands',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ commands: telegramCommands }),
      }),
    );
  });

  it('surfaces a Telegram provider rejection', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ ok: false, description: 'Unauthorized' }),
    });
    await expect(configureTelegramCommands({ token: 'invalid', request })).rejects.toThrow('Unauthorized');
  });
});
