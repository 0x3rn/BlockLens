import { useCallback, useEffect, useRef } from 'react';
import { AlertCondition, Coin, CurrencyCode, PriceAlert } from '../types/crypto';
import { usePersistentState } from '../hooks/usePersistentState';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';

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
  const { user } = useAuth();
  const [alerts, setAlerts] = usePersistentState<PriceAlert[]>(
    'blocklens_alerts',
    [],
    isAlerts,
  );
  const cloudReady = useRef(false);

  const createAlertId = () => {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const random = Math.floor(Math.random() * 16);
      const value = character === 'x' ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  };

  useEffect(() => {
    let cancelled = false;
    cloudReady.current = false;
    if (!supabase || !user) return undefined;
    void supabase.from('price_alerts').select('id, coin_id, condition, threshold, currency, created_at, triggered_at').eq('user_id', user.id).order('created_at', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setAlerts((data ?? []).map((row) => ({
          id: row.id,
          coinId: row.coin_id,
          condition: row.condition as AlertCondition,
          threshold: Number(row.threshold),
          currency: row.currency as CurrencyCode,
          createdAt: row.created_at,
          ...(row.triggered_at ? { triggeredAt: row.triggered_at } : {}),
        })));
        cloudReady.current = true;
      });
    return () => { cancelled = true; };
  }, [setAlerts, user]);

  const addAlert = useCallback((coinId: string, condition: AlertCondition, threshold: number, currency: PriceAlert['currency']) => {
    const id = createAlertId();
    const createdAt = new Date().toISOString();
    setAlerts((previous) => [...previous.slice(-99), { id, coinId, condition, threshold, currency, createdAt }]);
    if (supabase && user && cloudReady.current) {
      void supabase.from('price_alerts').insert({ id, user_id: user.id, coin_id: coinId, condition, threshold, currency, created_at: createdAt });
    }
  }, [setAlerts, user]);

  const removeAlert = useCallback((id: string) => {
    setAlerts((previous) => previous.filter((alert) => alert.id !== id));
    if (supabase && user && cloudReady.current) void supabase.from('price_alerts').delete().eq('user_id', user.id).eq('id', id);
  }, [setAlerts, user]);

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
      const triggeredAt = triggered ? new Date().toISOString() : undefined;
      if (triggeredAt && supabase && user && cloudReady.current) {
        void supabase.from('price_alerts').update({ triggered_at: triggeredAt }).eq('user_id', user.id).eq('id', alert.id);
      }
      return triggeredAt ? { ...alert, triggeredAt } : alert;
    }));
  }, [activeCurrency, setAlerts, user]);

  return { alerts, addAlert, removeAlert, evaluateAlerts };
};
