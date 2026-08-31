import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { MarketProvider } from './context/MarketContext';

vi.mock('./services/api', () => ({
  fetchMarketData: vi.fn().mockResolvedValue([{
    id: 'bitcoin',
    symbol: 'btc',
    name: 'Bitcoin',
    image: 'https://example.com/bitcoin.png',
    current_price: 65000.123,
    market_cap: 1_280_000_000_000,
    market_cap_rank: 1,
    total_volume: 42_000_000_000,
    high_24h: 66000,
    low_24h: 63000,
    price_change_percentage_24h: 2.5,
    price_change_percentage_7d_in_currency: 4.2,
    price_change_percentage_30d_in_currency: 8.1,
  }]),
  fetchMarketMetrics: vi.fn().mockResolvedValue({
    totalMarketCap: 2_500_000_000_000,
    totalVolume24h: 95_000_000_000,
    marketCapChange24h: 1.2,
    bitcoinDominance: 52,
    activeCryptocurrencies: 14000,
    trackedMarkets: 1100,
    updatedAt: Date.now(),
  }),
  fetchTrendingCoins: vi.fn().mockResolvedValue([]),
  fetchCoinHistory: vi.fn().mockResolvedValue([]),
  fetchCoinDetail: vi.fn(),
  requestAIAnalysis: vi.fn(),
  getApiErrorMessage: vi.fn(() => 'Data unavailable.'),
}));

const renderRoute = (path = '/') => render(
  <MemoryRouter initialEntries={[path]}>
    <MarketProvider><App /></MarketProvider>
  </MemoryRouter>,
);

describe('BlockLens routes', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  it('loads the market dashboard with real-data labels', async () => {
    renderRoute();
    expect(await screen.findByRole('heading', { name: /see the market clearly/i })).toBeInTheDocument();
    expect(await screen.findByText(/global market overview/i)).toBeInTheDocument();
    expect(screen.getAllByText(/coingecko/i).length).toBeGreaterThan(0);
  });

  it('renders a useful not-found route', async () => {
    renderRoute('/missing-page');
    expect(await screen.findByRole('heading', { name: /this page does not exist/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /return to dashboard/i })).toHaveAttribute('href', '/');
  });

  it('does not evaluate a saved price threshold against a different currency feed', async () => {
    window.localStorage.setItem('blocklens_currency', JSON.stringify('eur'));
    window.localStorage.setItem('blocklens_alerts', JSON.stringify([{
      id: 'bitcoin-above-1',
      coinId: 'bitcoin',
      condition: 'above',
      threshold: 100,
      currency: 'usd',
      createdAt: '2026-08-30T00:00:00.000Z',
    }]));
    renderRoute();
    await screen.findByRole('heading', { name: /see the market clearly/i });
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem('blocklens_alerts') ?? '[]');
      expect(saved[0].triggeredAt).toBeUndefined();
    });
  });
});
