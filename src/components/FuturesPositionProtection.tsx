import { FormEvent, useState } from 'react';
import { FuturesActionResult } from '../hooks/usePaperFutures';
import { PaperFuturesPosition } from '../types/crypto';
import { formatCurrency } from '../utils/format';

interface Props {
  position: PaperFuturesPosition;
  markPrice: number | undefined;
  busy: boolean;
  onSave: (positionId: string, markPrice: number, stopLoss: number | null, takeProfit: number | null) => FuturesActionResult;
  onSuccess: (message: string) => void;
}

export const FuturesPositionProtection = ({ position, markPrice, busy, onSave, onSuccess }: Props) => {
  const [editing, setEditing] = useState(false);
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const priceAvailable = typeof markPrice === 'number' && Number.isFinite(markPrice) && markPrice > 0;
  const edit = () => {
    setStop(position.stopLoss == null ? '' : String(position.stopLoss));
    setTarget(position.takeProfit == null ? '' : String(position.takeProfit));
    setError(null);
    setEditing(true);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !priceAvailable) return;
    const result = onSave(position.id, markPrice!, stop.trim() ? Number(stop) : null, target.trim() ? Number(target) : null);
    if (!result.ok) { setError(result.message); return; }
    setEditing(false);
    setError(null);
    onSuccess(result.message);
  };

  return (
    <div className="futures-position-protection">
      {!editing ? (
        <button type="button" className="futures-protection-button" onClick={edit} disabled={busy || !priceAvailable} aria-label={`Edit TP/SL for ${position.coinName}`}>Edit TP/SL</button>
      ) : (
        <form className="futures-protection-form" onSubmit={save} aria-label={`TP/SL for ${position.coinName}`}>
          <strong>Take profit / Stop loss</strong>
          <p>Mark price: {priceAvailable ? formatCurrency(markPrice!, 'usd') : 'Unavailable'}. Leave a field empty to remove its limit.</p>
          <div className="futures-protection-fields">
            <label>Stop loss (USD)<input type="number" min="0" step="any" inputMode="decimal" value={stop} onChange={event => { setStop(event.target.value); setError(null); }} disabled={busy} aria-label={`Stop loss for ${position.coinName}`} /></label>
            <label>Take profit (USD)<input type="number" min="0" step="any" inputMode="decimal" value={target} onChange={event => { setTarget(event.target.value); setError(null); }} disabled={busy} aria-label={`Take profit for ${position.coinName}`} /></label>
          </div>
          {error && <p className="futures-form-error" role="alert">{error}</p>}
          <div className="futures-protection-actions">
            <button type="button" className="futures-protection-button" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="futures-protection-save" disabled={busy || !priceAvailable}>Save TP/SL</button>
          </div>
        </form>
      )}
    </div>
  );
};
