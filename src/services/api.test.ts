import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AxiosError } from 'axios';
import { CONTROLLED_ERROR_MESSAGES, getApiErrorMessage, normalizeCoinPaprikaTickers } from './api';

describe('CoinPaprika market normalization', () => {
  it('creates CoinGecko-compatible assets for the browser fallback', () => {
    const coins = normalizeCoinPaprikaTickers([{
      id: 'bnb-binance-coin',
      name: 'BNB',
      symbol: 'BNB',
      rank: 4,
      last_updated: '2026-09-29T13:58:15Z',
      quotes: {
        NGN: {
          price: 1_200_000,
          market_cap: 167_000_000_000_000,
          volume_24h: 5_000_000_000_000,
          percent_change_24h: 1.2,
          percent_change_7d: -0.8,
          percent_change_30d: 4.5,
        },
      },
    }], 'ngn');

    expect(coins).toHaveLength(1);
    expect(coins[0]).toMatchObject({
      id: 'binancecoin',
      symbol: 'bnb',
      current_price: 1_200_000,
      market_cap_rank: 4,
      price_change_percentage_7d_in_currency: -0.8,
    });
  });
});

describe('getApiErrorMessage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('logs only status and code, without request tokens or credentials', () => {
    const rawError = { isAxiosError: true, code: 'ERR_BAD_REQUEST', response: { status: 403, data: { code: 'TURNSTILE_VERIFICATION_FAILED' } },
      config: { data: '{"cf-turnstile-response":"sensitive-token"}' } };
    expect(getApiErrorMessage(rawError, 'ai')).toBe(CONTROLLED_ERROR_MESSAGES.verification);
    expect(console.error).toHaveBeenCalledWith('API request failed:', { status: 403, code: 'ERR_BAD_REQUEST' });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('sensitive-token');
  });

  it('returns generic market error for standard market failures', () => {
    const rawError = new Error('CoinGecko returned HTTP 500');
    expect(getApiErrorMessage(rawError, 'market')).toBe(
      CONTROLLED_ERROR_MESSAGES.genericMarket,
    );
  });

  it('handles rate limit errors (HTTP 429 and text matches)', () => {
    const axios429 = {
      isAxiosError: true,
      name: 'AxiosError',
      message: 'Request failed with status code 429',
      response: { status: 429, data: { error: 'Too Many Requests' } },
    } as unknown as AxiosError;

    expect(getApiErrorMessage(axios429, 'market')).toBe(
      CONTROLLED_ERROR_MESSAGES.rateLimit,
    );

    const textError = new Error('Client exceeded request quota: rate limit applied');
    expect(getApiErrorMessage(textError, 'market')).toBe(
      CONTROLLED_ERROR_MESSAGES.rateLimit,
    );
  });

  it('handles timeout errors (ECONNABORTED, 408, and message matches)', () => {
    const axiosTimeout = {
      isAxiosError: true,
      name: 'AxiosError',
      code: 'ECONNABORTED',
      message: 'timeout of 15000ms exceeded',
    } as unknown as AxiosError;

    expect(getApiErrorMessage(axiosTimeout, 'market')).toBe(
      CONTROLLED_ERROR_MESSAGES.timeout,
    );

    const messageTimeout = new Error('The operation was aborted due to timeout');
    expect(getApiErrorMessage(messageTimeout, 'market')).toBe(
      CONTROLLED_ERROR_MESSAGES.timeout,
    );
  });

  it('handles network failures (no response, ERR_NETWORK, offline)', () => {
    const axiosNetworkError = {
      isAxiosError: true,
      name: 'AxiosError',
      code: 'ERR_NETWORK',
      message: 'Network Error',
      response: undefined,
    } as unknown as AxiosError;

    expect(getApiErrorMessage(axiosNetworkError, 'market')).toBe(
      CONTROLLED_ERROR_MESSAGES.network,
    );

    const offlineError = new Error('Failed to fetch: browser is offline');
    expect(getApiErrorMessage(offlineError, 'market')).toBe(
      CONTROLLED_ERROR_MESSAGES.network,
    );
  });

  it('handles partial data failures', () => {
    expect(getApiErrorMessage('Metrics unavailable', 'partial')).toBe(
      CONTROLLED_ERROR_MESSAGES.partial,
    );

    const partialError = new Error('Partial dataset returned');
    expect(getApiErrorMessage(partialError, 'market')).toBe(
      CONTROLLED_ERROR_MESSAGES.partial,
    );
  });

  it('handles AI request failures without leaking internal provider/model details', () => {
    const rawAiError = new Error('Vertex AI gemini-3.7-flash internal server exception');
    expect(getApiErrorMessage(rawAiError, 'ai')).toBe(
      CONTROLLED_ERROR_MESSAGES.ai,
    );

    const axiosAi500 = {
      isAxiosError: true,
      name: 'AxiosError',
      response: { status: 502, data: { error: 'Cloudflare Worker upstream gateway error' } },
    } as unknown as AxiosError;
    expect(getApiErrorMessage(axiosAi500, 'ai')).toBe(
      CONTROLLED_ERROR_MESSAGES.ai,
    );
  });

  it('handles authentication and session problems', () => {
    const axios401 = {
      isAxiosError: true,
      name: 'AxiosError',
      response: { status: 401, data: { error: 'JWT expired' } },
    } as unknown as AxiosError;

    expect(getApiErrorMessage(axios401, 'auth')).toBe(
      CONTROLLED_ERROR_MESSAGES.auth,
    );

    const sessionError = new Error('User session token has expired');
    expect(getApiErrorMessage(sessionError, 'auth')).toBe(
      CONTROLLED_ERROR_MESSAGES.auth,
    );
  });
  it.each(['market', 'ai'] as const)('does not blame the user’s session for %s provider authorization failures', context => {
    const providerError = { isAxiosError: true, response: { status: 403, data: { error: 'Upstream API token expired' } } };
    expect(getApiErrorMessage(providerError, context)).toBe(context === 'market' ? CONTROLLED_ERROR_MESSAGES.genericMarket : CONTROLLED_ERROR_MESSAGES.ai);
  });
  it('does not blame the user’s connection or request volume for server configuration failures', () => {
    const serverError = { isAxiosError: true, response: { status: 503, data: { error: 'Quota database connection is not configured' } } };
    expect(getApiErrorMessage(serverError, 'ai')).toBe(CONTROLLED_ERROR_MESSAGES.ai);
  });

  it('returns fallback message for unknown or unclassified errors', () => {
    expect(getApiErrorMessage({}, 'general')).toBe(
      CONTROLLED_ERROR_MESSAGES.unknown,
    );
  });

  it('preserves already-controlled messages', () => {
    expect(
      getApiErrorMessage(CONTROLLED_ERROR_MESSAGES.genericMarket),
    ).toBe(CONTROLLED_ERROR_MESSAGES.genericMarket);
    expect(
      getApiErrorMessage(CONTROLLED_ERROR_MESSAGES.partial),
    ).toBe(CONTROLLED_ERROR_MESSAGES.partial);
  });
});
