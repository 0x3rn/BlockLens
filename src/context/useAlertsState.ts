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
const cloudOwnerKey = 'blocklens_alerts_cloud_user';

export const useAlertsState = (activeCurrency: CurrencyCode) => {
  const { user } = useAuth();
  const client = supabase;
  const [alerts, setAlerts] = usePersistentState<PriceAlert[]>(
    'blocklens_alerts',
    [],
    isAlerts,
  );
  const cloudReady = useRef(false);
  const alertsRef = useRef(alerts);
  const pendingChanges = useRef(new Map<string, PriceAlert | null>());

  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

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
    pendingChanges.current.clear();
    if (!client || !user) return undefined;
    const loadCloudAlerts = async () => {
      const { data, error } = await client
        .from('price_alerts')
        .select('id, coin_id, condition, threshold, currency, created_at, triggered_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (cancelled || error) return;

      const remoteAlerts = (data ?? []).map((row) => ({
          id: row.id,
          coinId: row.coin_id,
          condition: row.condition as AlertCondition,
          threshold: Number(row.threshold),
          currency: row.currency as CurrencyCode,
          createdAt: row.created_at,
          ...(row.triggered_at ? { triggeredAt: row.triggered_at } : {}),
      }));
      const nextById = new Map<string, PriceAlert>();
      let previousOwner: string | null = null;
      try { previousOwner = window.localStorage.getItem(cloudOwnerKey); } catch { /* Storage can be unavailable. */ }
      const canMigrateLocal = !previousOwner || previousOwner === user.id;
      (remoteAlerts.length > 0 || !canMigrateLocal ? remoteAlerts : alertsRef.current).forEach((alert) => nextById.set(alert.id, alert));
      pendingChanges.current.forEach((alert, id) => {
        if (alert) nextById.set(id, alert);
        else nextById.delete(id);
      });
      const resolvedAlerts = [...nextById.values()];
      alertsRef.current = resolvedAlerts;
      setAlerts(resolvedAlerts);
      cloudReady.current = true;
      try { window.localStorage.setItem(cloudOwnerKey, user.id); } catch { /* Storage can be unavailable. */ }

      const resolvedIds = new Set(resolvedAlerts.map((alert) => alert.id));
      const removedIds = remoteAlerts.filter((alert) => !resolvedIds.has(alert.id)).map((alert) => alert.id);
      if (removedIds.length > 0) {
        await client.from('price_alerts').delete().eq('user_id', user.id).in('id', removedIds);
      }
      if (resolvedAlerts.length > 0) {
        await client.from('price_alerts').upsert(resolvedAlerts.map((alert) => ({
          id: alert.id,
          user_id: user.id,
          coin_id: alert.coinId,
          condition: alert.condition,
          threshold: alert.threshold,
          currency: alert.currency,
          created_at: alert.createdAt,
          triggered_at: alert.triggeredAt ?? null,
        })), { onConflict: 'id' });
      }
    };

    void loadCloudAlerts();
    return () => { cancelled = true; };
  }, [setAlerts, user]);

  const addAlert = useCallback((coinId: string, condition: AlertCondition, threshold: number, currency: PriceAlert['currency']) => {
    const id = createAlertId();
    const createdAt = new Date().toISOString();
    const nextAlert = { id, coinId, condition, threshold, currency, createdAt };
    alertsRef.current = [...alertsRef.current.slice(-99), nextAlert];
    setAlerts(alertsRef.current);
    if (client && user) {
      if (!cloudReady.current) pendingChanges.current.set(id, nextAlert);
      else void client.from('price_alerts').insert({ id, user_id: user.id, coin_id: coinId, condition, threshold, currency, created_at: createdAt });
    }
  }, [setAlerts, user]);

  const removeAlert = useCallback((id: string) => {
    alertsRef.current = alertsRef.current.filter((alert) => alert.id !== id);
    setAlerts(alertsRef.current);
    if (client && user) {
      if (!cloudReady.current) pendingChanges.current.set(id, null);
      else void client.from('price_alerts').delete().eq('user_id', user.id).eq('id', id);
    }
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
