import { useCallback, useEffect, useRef } from 'react';
import { CurrencyCode, PositionHistoryAction, PositionHistoryEntry } from '../types/crypto';
import { usePersistentState } from './usePersistentState';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const MAX_HISTORY = 100;

const isPositionHistory = (value: unknown): value is PositionHistoryEntry[] => (
  Array.isArray(value) && value.length <= MAX_HISTORY && value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const entry = item as PositionHistoryEntry;
    return typeof entry.id === 'string'
      && /^[a-zA-Z0-9-]{1,120}$/.test(entry.id)
      && typeof entry.coinId === 'string'
      && /^[a-z0-9-]{1,100}$/.test(entry.coinId)
      && ['added', 'updated', 'removed'].includes(entry.action)
      && typeof entry.quantity === 'number'
      && Number.isFinite(entry.quantity)
      && entry.quantity >= 0
      && typeof entry.averageCost === 'number'
      && Number.isFinite(entry.averageCost)
      && entry.averageCost >= 0
      && ['usd', 'eur', 'gbp', 'ngn'].includes(entry.currency)
      && typeof entry.createdAt === 'string';
  })
);

const createId = () => {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* Use the fallback below when crypto is unavailable. */ }
  return `position-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const usePositionHistory = () => {
  const { user, loading: authLoading } = useAuth();
  const [history, setHistory] = usePersistentState<PositionHistoryEntry[]>(
    'blocklens_position_history',
    [],
    isPositionHistory,
    !authLoading && !user,
  );
  const historyRef = useRef(history);
  const cloudReady = useRef(false);
  const pendingCreates = useRef<PositionHistoryEntry[]>([]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    let cancelled = false;
    cloudReady.current = false;
    pendingCreates.current = [];
    const client = supabase;
    if (!client || !user) return undefined;

    const loadCloudHistory = async () => {
      const { data, error } = await client
        .from('position_history')
        .select('id, coin_id, action, quantity, average_cost, currency, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(MAX_HISTORY);
      if (cancelled || error || !data) return;

      const remote = data.map((row) => ({
        id: row.id,
        coinId: row.coin_id,
        action: row.action as PositionHistoryAction,
        quantity: Number(row.quantity),
        averageCost: Number(row.average_cost),
        currency: row.currency as CurrencyCode,
        createdAt: row.created_at,
      }));
      const byId = new Map<string, PositionHistoryEntry>();
      remote.forEach((entry) => byId.set(entry.id, entry));
      pendingCreates.current.forEach((entry) => byId.set(entry.id, entry));
      const resolved = [...byId.values()]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, MAX_HISTORY);
      historyRef.current = resolved;
      setHistory(resolved);
      cloudReady.current = true;

      const remoteIds = new Set(remote.map((entry) => entry.id));
      const localOnly = resolved.filter((entry) => !remoteIds.has(entry.id));
      if (localOnly.length > 0) {
        await client.from('position_history').upsert(localOnly.map((entry) => ({
          id: entry.id,
          user_id: user.id,
          coin_id: entry.coinId,
          action: entry.action,
          quantity: entry.quantity,
          average_cost: entry.averageCost,
          currency: entry.currency,
          created_at: entry.createdAt,
        })), { onConflict: 'id' });
      }
      pendingCreates.current = [];
    };

    void loadCloudHistory();
    return () => { cancelled = true; };
  }, [setHistory, user]);

  const recordPositionEvent = useCallback((input: Omit<PositionHistoryEntry, 'id' | 'createdAt'>) => {
    const entry: PositionHistoryEntry = { ...input, id: createId(), createdAt: new Date().toISOString() };
    const next = [entry, ...historyRef.current].slice(0, MAX_HISTORY);
    historyRef.current = next;
    setHistory(next);
    if (!supabase || !user) return;
    if (!cloudReady.current) {
      pendingCreates.current.push(entry);
      return;
    }
    void supabase.from('position_history').upsert({
      id: entry.id,
      user_id: user.id,
      coin_id: entry.coinId,
      action: entry.action,
      quantity: entry.quantity,
      average_cost: entry.averageCost,
      currency: entry.currency,
      created_at: entry.createdAt,
    }, { onConflict: 'id' });
  }, [setHistory, user]);

  return { history, recordPositionEvent };
};
