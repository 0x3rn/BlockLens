import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info';

type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  showToast: (message: string, tone?: ToastTone) => void;
  dismissToast: (id: string) => void;
};

const fallbackToastContext: ToastContextValue = {
  showToast: () => undefined,
  dismissToast: () => undefined,
};
const ToastContext = createContext<ToastContextValue>(fallbackToastContext);

const ToastIcon: React.FC<{ tone: ToastTone }> = ({ tone }) => {
  if (tone === 'error') return <CircleAlert size={17} aria-hidden="true" />;
  if (tone === 'info') return <Info size={17} aria-hidden="true" />;
  return <CheckCircle2 size={17} aria-hidden="true" />;
};

const ToastViewport: React.FC<{ toasts: ToastItem[]; onDismiss: (id: string) => void }> = ({ toasts, onDismiss }) => (
  <div className="toast-viewport" aria-live="polite" aria-atomic="false">
    {toasts.map((toast) => (
      <div className={`toast toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'} key={toast.id}>
        <span className="toast-icon"><ToastIcon tone={toast.tone} /></span>
        <p>{toast.message}</p>
        <button type="button" className="toast-dismiss" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    ))}
  </div>
);

export const ToastProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());
  const sequence = useRef(0);

  const dismissToast = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer != null) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = `toast-${Date.now()}-${sequence.current += 1}`;
    setToasts((previous) => [...previous.slice(-3), { id, message, tone }]);
    const timer = window.setTimeout(() => dismissToast(id), 4200);
    timers.current.set(id, timer);
  }, [dismissToast]);

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }, []);

  const value = useMemo(() => ({ showToast, dismissToast }), [dismissToast, showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  return useContext(ToastContext);
};
