import React, { useState } from 'react';
import { AlertTriangle, LoaderCircle, RefreshCw } from 'lucide-react';

interface DataStateProps {
  title?: string;
  message: string;
  onRetry?: () => void | Promise<void>;
  compact?: boolean;
}

export const DataState: React.FC<DataStateProps> = ({
  title = 'Market data unavailable',
  message,
  onRetry,
  compact = false,
}) => {
  const [retrying, setRetrying] = useState(false);
  const handleRetry = async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
  <div className={`data-state ${compact ? 'data-state--compact' : ''}`} role="status" aria-busy={retrying}>
    <AlertTriangle size={22} aria-hidden="true" />
    <div>
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
    {onRetry && (
      <button type="button" className="secondary-button" onClick={() => void handleRetry()} disabled={retrying}>
        {retrying ? <LoaderCircle size={15} className="is-spinning" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />} {retrying ? 'Retrying...' : 'Retry'}
      </button>
    )}
  </div>
  );
};
