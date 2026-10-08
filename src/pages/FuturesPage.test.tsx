import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePaperFutures } from '../hooks/usePaperFutures';
import type { Coin } from '../types/crypto';
const mocks = vi.hoisted(() => ({ toast: vi.fn(), coinIds: null as string[] | null }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../lib/database', () => ({ database: null }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('../hooks/useFuturesMarketPrice', async importOriginal => ({ ...await importOriginal<object>(), useFuturesMarketPrice: (coin: Coin | null) => ({ price: coin?.current_price ?? 0, priceCoinId: coin?.id ?? null, status: 'live', lastUpdated: Date.now(), fundingRate: .0001, retry: vi.fn() }) }));
vi.mock('../context/MarketContext', () => ({ useMarket: () => {
  const paper = usePaperFutures();
  return { coins: [{ id: 'bitcoin', name: 'Bitcoin', symbol: 'btc', current_price: 100, high_24h: 110, low_24h: 90 }, { id: 'ethereum', name: 'Ethereum', symbol: 'eth', current_price: 200, high_24h: 210, low_24h: 190 }].filter(coin => !mocks.coinIds || mocks.coinIds.includes(coin.id)), currency: 'usd', loading: false, error: null, refresh: vi.fn(), aiHistory: [], positionHistory: [], positions: [],
    paperFutures: paper.account, paperFuturesSyncStatus: paper.syncStatus, paperFuturesSyncError: paper.syncError, retryPaperFuturesSync: paper.retrySync,
    openFuturesPosition: paper.openPosition, closeFuturesPosition: paper.closePosition, placeFuturesOrder: paper.placeOrder, cancelFuturesOrder: paper.cancelOrder, checkFuturesOrders: paper.checkOrders, checkFuturesPosition: paper.checkPosition };
} }));
import FuturesPage from './FuturesPage';
import HistoryPage from './HistoryPage';
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); mocks.coinIds = null; });
const setup = async () => {
  render(<MemoryRouter initialEntries={['/futures?coin=bitcoin']}><FuturesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open long' })).toBeEnabled());
};
const change = (label: string, value: string) => fireEvent.change(screen.getByRole('spinbutton', { name: label }), { target: { value } });
const ticket = () => screen.getByRole('heading', { name: /Open a position|Reduce a position/ }).closest('form')!;
const submit = () => fireEvent.submit(ticket());
describe('Trade screen regression flows', () => {
  it('keeps the selected asset when a market refresh removes it from the top list', async () => {
    const page = <MemoryRouter initialEntries={['/futures?coin=ethereum']}><FuturesPage /></MemoryRouter>;
    const view = render(page);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open long' })).toBeEnabled());
    mocks.coinIds = ['bitcoin'];
    view.rerender(<MemoryRouter initialEntries={['/futures?coin=ethereum']}><FuturesPage /></MemoryRouter>);
    expect(screen.getByRole('combobox', { name: 'Trade asset' })).toHaveValue('ethereum');
    expect(within(ticket()).getByText('Ethereum')).toBeInTheDocument();
    expect(within(ticket()).getByText('2.5 ETH')).toBeInTheDocument();
  });
  it('previews limit quantity at entry and rejects protection on the wrong side', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Limit' }));
    change('Margin (USD)', '10'); change('Limit price', '80'); change('Stop loss price', '90');
    expect(within(ticket()).getByText('0.625 BTC')).toBeInTheDocument();
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('entry price');
    expect(screen.queryByRole('region', { name: 'Open orders' })).not.toBeInTheDocument();
  });
  it('keeps account equity when placing and cancelling a limit order', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Limit' }));
    change('Margin (USD)', '10'); change('Limit price', '80'); submit();
    const summary = screen.getByRole('region', { name: 'Simulated account summary' });
    expect(within(summary).getByText('$10,000.00')).toBeInTheDocument();
    expect(within(summary).getByText('$9,989.98')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(within(summary).getAllByText('$10,000.00')).toHaveLength(2);
  });
  it('uses the ticket reduction percentage and displays a reduction confirmation', async () => {
    await setup(); change('Margin (USD)', '10'); submit();
    fireEvent.click(screen.getByRole('checkbox', { name: /Reduce only/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Amount to reduce' }), { target: { value: '25' } });
    expect(within(ticket()).getByRole('button', { name: /Short\s*Sell/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(ticket()).getByRole('button', { name: 'Reduce position' })).toBeEnabled();
    submit();
    expect(mocks.toast).toHaveBeenLastCalledWith('BTC position reduced.');
    expect(screen.getByText(/0.375 BTC.*margin/)).toBeInTheDocument();
  });
  it('keeps closing percentages independent for multiple positions', async () => {
    await setup(); change('Margin (USD)', '10'); submit();
    fireEvent.change(screen.getByRole('combobox', { name: 'Amount to close Bitcoin' }), { target: { value: '25' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Trade asset' }), { target: { value: 'ethereum' } });
    change('Margin (USD)', '10'); submit();
    expect(screen.getByRole('combobox', { name: 'Amount to close Ethereum' })).toHaveValue('100');
    expect(screen.getByRole('combobox', { name: 'Amount to close Bitcoin' })).toHaveValue('25');
  });
  it('clears asset-specific protection and entry prices when changing assets', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Limit' }));
    change('Limit price', '80'); change('Stop loss price', '70');
    fireEvent.change(screen.getByRole('combobox', { name: 'Trade asset' }), { target: { value: 'ethereum' } });
    expect(screen.getByRole('spinbutton', { name: 'Limit price' })).toHaveValue(null);
    expect(screen.getByRole('spinbutton', { name: 'Stop loss price' })).toHaveValue(null);
  });
  it('links to paper trade history and opens that view directly', async () => {
    await setup(); change('Margin (USD)', '10'); submit();
    expect(screen.getByRole('link', { name: 'View History' })).toHaveAttribute('href', '/history?view=futures');
    cleanup();
    render(<MemoryRouter initialEntries={['/history?view=futures']}><HistoryPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('tabpanel', { name: 'Paper trade history' })).toHaveTextContent('Bitcoin'));
    expect(screen.getByRole('tab', { name: /Paper trades/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Entry cost')).toBeInTheDocument();
  });
});
