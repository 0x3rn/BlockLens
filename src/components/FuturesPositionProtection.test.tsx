import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FuturesPositionProtection } from './FuturesPositionProtection';
import type { PaperFuturesPosition } from '../types/crypto';

const position: PaperFuturesPosition = { id: 'p', coinId: 'bitcoin', coinName: 'Bitcoin', symbol: 'btc', side: 'long', quantity: 2, entryPrice: 100, margin: 40, leverage: 5, marginMode: 'isolated', stopLoss: null, takeProfit: null, openedAt: '2026-10-11T00:00:00Z', lastFundingAt: '2026-10-11T00:00:00Z' };
afterEach(cleanup);
const setup = (props: Partial<PaperFuturesPosition> = {}) => {
  const renderEditor = (p: PaperFuturesPosition) => <FuturesPositionProtection position={p} markPrice={p.side === 'long' ? 120 : 80} busy={false} onSave={vi.fn(() => ({ ok: true, message: 'Updated' }))} onSuccess={vi.fn()} />;
  const view = render(renderEditor({ ...position, ...props }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit TP/SL for Bitcoin' }));
  return { view, renderEditor };
};
describe('active position TP/SL estimates', () => {
  it.each([
    ['long', 90, 'loss: -$20.00 (-50.00% ROE)'],
    ['short', 110, 'loss: -$20.00 (-50.00% ROE)'],
    ['long', 110, 'profit: +$20.00 (+50.00% ROE)'],
    ['short', 90, 'profit: +$20.00 (+50.00% ROE)'],
  ] as const)('shows the correct %s stop result at %s', (side, stop, expected) => {
    setup({ side });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Stop loss for Bitcoin' }), { target: { value: String(stop) } });
    expect(screen.getByRole('status', { name: 'Stop loss estimated result' })).toHaveTextContent(expected);
  });
  it.each([['long', 130], ['short', 70]] as const)('shows %s take-profit estimates', (side, target) => {
    setup({ side });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Take profit for Bitcoin' }), { target: { value: String(target) } });
    expect(screen.getByRole('status', { name: 'Take profit estimated result' })).toHaveTextContent('profit: +$60.00 (+150.00% ROE)');
  });
  it('updates the estimate after a partial reduction and removes it when cleared', () => {
    const { view, renderEditor } = setup({ stopLoss: 110 });
    expect(screen.getByRole('status')).toHaveTextContent('+$20.00');
    view.rerender(renderEditor({ ...position, quantity: 1, margin: 20, stopLoss: 110 }));
    expect(screen.getByRole('status')).toHaveTextContent('+$10.00 (+50.00% ROE)');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Stop loss for Bitcoin' }), { target: { value: '' } });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('does not show misleading estimates for zero or invalid prices', () => {
    setup();
    for (const value of ['0', '-1', 'not-a-price']) {
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Stop loss for Bitcoin' }), { target: { value } });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    }
    expect(screen.getByText(/before fees and funding/)).toBeInTheDocument();
  });
});
