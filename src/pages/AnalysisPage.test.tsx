import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AnalysisPage from './AnalysisPage';
import { requestAIAnalysis } from '../services/api';
import type { AIAnalysis } from '../types/crypto';

const { save, toast } = vi.hoisted(() => ({ save: vi.fn(), toast: vi.fn() }));
vi.mock('../context/MarketContext', () => ({ useMarket: () => ({
  coins: [
    { id: 'bitcoin', name: 'Bitcoin', symbol: 'btc', image: '', current_price: 100, market_cap_rank: 1 },
    { id: 'ripple', name: 'XRP', symbol: 'xrp', image: '', current_price: 2, market_cap_rank: 3 },
  ], currency: 'usd', saveAIAnalysis: save,
}) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: toast }) }));
vi.mock('../components/PriceChart', () => ({ default: () => <div>Price chart</div> }));
vi.mock('../hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('../services/api', () => ({ requestAIAnalysis: vi.fn(), getApiErrorMessage: () => 'Please try again.' }));

const brief = (headline = 'A conditional setup'): AIAnalysis => ({
  mode: 'swing', headline, summary: 'Evidence from closed candles.', stance: 'neutral', confidence: 60, risk: 'high',
  timeframe: '3 days–4 weeks', supportLevels: ['$95'], resistanceLevels: ['$110'],
  tradeSetup: { signal: 'long', rationale: 'Entry requires a breakout.', entryZone: '$105', stopLoss: '$95', takeProfitLevels: ['$125'], riskReward: '1:2', invalidation: 'Close below $95.', positionRisk: 'Define the loss limit before entry.' },
  scenarios: [], methodology: 'Closed candles.', research: { status: 'unavailable', coinCatalysts: [], macroCatalysts: [], sources: [], note: 'Technical-only.' },
  dataAsOf: '2026-10-09T00:00:00Z', generatedAt: '2026-10-09T00:00:00Z',
});

const Navigation = () => {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>Go back</button>;
};
const showPage = (path = '/analysis?coin=bitcoin') => render(<MemoryRouter initialEntries={[path]}><AnalysisPage /><Navigation /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requestAIAnalysis).mockReset();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
});
afterEach(cleanup);

describe('analysis approaches', () => {
  it('defaults to Conservative and preserves the existing request contract', async () => {
    vi.mocked(requestAIAnalysis).mockResolvedValue(brief());
    const user = userEvent.setup();
    showPage();
    expect(screen.getByRole('tab', { name: 'Conservative' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('button', { name: 'Generate swing analysis' }));
    expect(requestAIAnalysis).toHaveBeenCalledWith({ coinId: 'bitcoin', currency: 'usd', mode: 'swing' });
    await screen.findByRole('heading', { name: 'A conditional setup' });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ analysis: expect.objectContaining({ riskProfile: 'conservative' }) }));
  });

  it('keeps Risk selected across horizon and asset changes and saves it with the brief', async () => {
    vi.mocked(requestAIAnalysis).mockResolvedValue({ ...brief(), mode: 'long-term', riskProfile: 'risk' });
    const user = userEvent.setup();
    showPage();
    await user.click(screen.getByRole('tab', { name: 'Risk' }));
    await user.click(screen.getByRole('radio', { name: /Long-term/ }));
    await user.selectOptions(screen.getByLabelText('Analyze asset'), 'ripple');
    await user.click(screen.getByRole('button', { name: 'Generate long-term analysis' }));
    expect(requestAIAnalysis).toHaveBeenCalledWith({ coinId: 'ripple', currency: 'usd', mode: 'long-term', riskProfile: 'risk' });
    expect(screen.getByRole('tab', { name: 'Risk' })).toHaveAttribute('aria-selected', 'true');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ coinId: 'ripple', analysis: expect.objectContaining({ riskProfile: 'risk' }) }));
  });

  it('restores profile and horizon on browser navigation and supports keyboard tabs', async () => {
    const user = userEvent.setup();
    showPage('/analysis?coin=bitcoin&mode=short-term&profile=risk');
    const risk = screen.getByRole('tab', { name: 'Risk' });
    risk.focus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Conservative' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Wait for stronger confirmation' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go back' }));
    expect(risk).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('radio', { name: /Short-term/ })).toHaveAttribute('aria-checked', 'true');
  });

  it.each(['profile', 'asset', 'horizon'] as const)('ignores a late response after changing %s', async (change) => {
    let resolve!: (value: AIAnalysis) => void;
    vi.mocked(requestAIAnalysis).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const user = userEvent.setup();
    showPage();
    await user.click(screen.getByRole('button', { name: 'Generate swing analysis' }));
    if (change === 'profile') await user.click(screen.getByRole('tab', { name: 'Risk' }));
    if (change === 'asset') await user.selectOptions(screen.getByLabelText('Analyze asset'), 'ripple');
    if (change === 'horizon') await user.click(screen.getByRole('radio', { name: /Short-term/ }));
    await act(async () => resolve(brief('Outdated response')));
    expect(screen.queryByRole('heading', { name: 'Outdated response' })).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    vi.mocked(requestAIAnalysis).mockResolvedValueOnce(brief('Current response'));
    await user.click(screen.getByRole('button', { name: /Generate .* analysis/ }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('heading', { name: 'Current response' })).toBeInTheDocument();
  });
});
