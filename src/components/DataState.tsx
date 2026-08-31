import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface DataStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}

export const DataState: React.FC<DataStateProps> = ({
  title = 'Market data unavailable',
  message,
  onRetry,
  compact = false,
}) => (
  <div className={`data-state ${compact ? 'data-state--compact' : ''}`} role="status">
    <AlertTriangle size={22} aria-hidden="true" />
    <div>
      <h2>{title}</h2>
      <p>{message}</p>
    </div>
    {onRetry && (
      <button type="button" className="secondary-button" onClick={onRetry}>
        <RefreshCw size={15} aria-hidden="true" /> Retry
      </button>
    )}
  </div>
);
