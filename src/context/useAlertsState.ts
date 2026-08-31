import { useCallback } from 'react';
import { AlertCondition, Coin, CurrencyCode, PriceAlert } from '../types/crypto';
import { usePersistentState } from '../hooks/usePersistentState';

const isAlerts = (value: unknown): value is PriceAlert[] => (
  Array.isArray(value) && value.length <= 100 && value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const alert = item as PriceAlert;
    return typeof alert.id === 'string'
      && alert.id.length <= 180
      && typeof alert.coinId === 'string'
      && /^[a-z0-9-]{1,100}$/.test(alert.coinId)
      && ['above', 'below', 'change'].includes(alert.condition)
      && typeof alert.threshold === 'number'
      && Number.isFinite(alert.threshold)
      && typeof alert.currency === 'string'
      && ['usd', 'eur', 'gbp', 'ngn'].includes(alert.currency)
      && typeof alert.createdAt === 'string';
  })
);

export const useAlertsState = (activeCurrency: CurrencyCode) => {
  const [alerts, setAlerts] = usePersistentState<PriceAlert[]>(
    'blocklens_alerts',
    [],
    isAlerts,
  );

  const addAlert = useCallback((coinId: string, condition: AlertCondition, threshold: number, currency: PriceAlert['currency']) => {
    const id = `${coinId}-${condition}-${Date.now()}`;
    setAlerts((previous) => [
      ...previous.slice(-99),
      { id, coinId, condition, threshold, currency, createdAt: new Date().toISOString() },
    ]);
  }, [setAlerts]);

  const removeAlert = useCallback((id: string) => {
    setAlerts((previous) => previous.filter((alert) => alert.id !== id));
  }, [setAlerts]);

  const evaluateAlerts = useCallback((nextCoins: Coin[]) => {
    setAlerts((previous) => previous.map((alert) => {
      if (alert.triggeredAt) return alert;
      const coin = nextCoins.find((item) => item.id === alert.coinId);
      if (!coin) return alert;
      const triggered = alert.condition === 'change'
        ? Math.abs(coin.price_change_percentage_24h ?? 0) >= alert.threshold
        : alert.currency !== activeCurrency
          ? false
          : alert.condition === 'above'
        ? coin.current_price >= alert.threshold
        : coin.current_price <= alert.threshold;
      return triggered ? { ...alert, triggeredAt: new Date().toISOString() } : alert;
    }));
  }, [activeCurrency, setAlerts]);

  return { alerts, addAlert, removeAlert, evaluateAlerts };
};
