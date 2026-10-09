import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AnalysisPage from './AnalysisPage';
import { requestAIAnalysis } from '../services/api';
import type { AIAnalysis } from '../types/crypto';
import type { TurnstileApi } from '../components/TurnstileVerification';

let widgetOptions: Parameters<TurnstileApi['render']>[1];
let autoVerify = true;
const widgetReset = vi.fn(() => { if (autoVerify) widgetOptions.callback('fresh-test-token'); });
const widgetRender = vi.fn((_element, options: typeof widgetOptions) => {
  widgetOptions = options;
  if (autoVerify) options.callback('fresh-test-token');
  return 'analysis-widget';
});

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
  autoVerify = true;
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'unit-test-site-key');
  window.turnstile = { ready: (callback) => callback(), render: widgetRender, reset: widgetReset, remove: vi.fn() };
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
});
afterEach(() => { cleanup(); delete window.turnstile; vi.unstubAllEnvs(); });

describe('analysis approaches', () => {
  it('keeps generation disabled until verification succeeds and clears expired/error tokens', async () => {
    autoVerify = false;
    const user = userEvent.setup();
    showPage();
    const generate = screen.getByRole('button', { name: 'Generate swing analysis' });
    await waitFor(() => expect(widgetRender).toHaveBeenCalled());
    expect(generate).toBeDisabled();
    await user.click(generate);
    expect(requestAIAnalysis).not.toHaveBeenCalled();
    act(() => widgetOptions.callback('first-token'));
    expect(generate).toBeEnabled();
    act(() => widgetOptions['expired-callback']());
    expect(generate).toBeDisabled();
    act(() => widgetOptions.callback('second-token'));
    act(() => widgetOptions['error-callback']());
    expect(generate).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry verification' }));
    await waitFor(() => expect(widgetRender).toHaveBeenCalledTimes(2));
    act(() => widgetOptions.callback('third-token'));
    expect(generate).toBeEnabled();
  });

  it.each(['success', 'failure'])('resets after a %s and requires a fresh token before retrying', async (outcome) => {
    autoVerify = false;
    if (outcome === 'success') vi.mocked(requestAIAnalysis).mockResolvedValue(brief());
    else vi.mocked(requestAIAnalysis).mockRejectedValue(new Error('upstream failed'));
    const user = userEvent.setup();
    showPage();
    await waitFor(() => expect(widgetRender).toHaveBeenCalled());
    act(() => widgetOptions.callback('spent-token'));
    await user.dblClick(screen.getByRole('button', { name: 'Generate swing analysis' }));
    await waitFor(() => expect(widgetReset).toHaveBeenCalledTimes(1));
    expect(requestAIAnalysis).toHaveBeenCalledTimes(1);
    const generate = screen.getByRole('button', { name: 'Generate swing analysis' });
    expect(generate).toBeDisabled();
    if (outcome === 'failure') expect(screen.getByRole('button', { name: 'Try analysis again' })).toBeDisabled();
    act(() => widgetOptions.callback('new-token'));
    expect(generate).toBeEnabled();
    await user.click(generate);
    expect(requestAIAnalysis).toHaveBeenLastCalledWith(expect.any(Object), 'new-token');
  });

  it('removes the widget on navigation and ignores callbacks from the old selection', async () => {
    autoVerify = false;
    const user = userEvent.setup();
    showPage();
    await waitFor(() => expect(widgetRender).toHaveBeenCalled());
    const oldOptions = widgetOptions;
    act(() => oldOptions.callback('old-token'));
    await user.click(screen.getByRole('tab', { name: 'Risk' }));
    await waitFor(() => expect(widgetRender).toHaveBeenCalledTimes(2));
    expect(window.turnstile?.remove).toHaveBeenCalledWith('analysis-widget');
    act(() => oldOptions.callback('late-old-token'));
    expect(screen.getByRole('button', { name: 'Generate swing analysis' })).toBeDisabled();
    act(() => widgetOptions.callback('current-token'));
    expect(screen.getByRole('button', { name: 'Generate swing analysis' })).toBeEnabled();
  });

  it('defaults to Conservative and preserves the existing request contract', async () => {
    vi.mocked(requestAIAnalysis).mockResolvedValue(brief());
    const user = userEvent.setup();
    showPage();
    expect(screen.getByRole('tab', { name: 'Conservative' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('button', { name: 'Generate swing analysis' }));
    expect(requestAIAnalysis).toHaveBeenCalledWith({ coinId: 'bitcoin', currency: 'usd', mode: 'swing' }, 'fresh-test-token');
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
    expect(requestAIAnalysis).toHaveBeenCalledWith({ coinId: 'ripple', currency: 'usd', mode: 'long-term', riskProfile: 'risk' }, 'fresh-test-token');
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
