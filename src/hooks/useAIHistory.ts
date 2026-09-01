import { useCallback, useEffect, useRef } from 'react';
import { AIAnalysis, AIAnalysisHistoryEntry, CurrencyCode } from '../types/crypto';
import { usePersistentState } from './usePersistentState';
import { useAuth } from '../context/AuthContext';
import { Json, supabase } from '../lib/supabase';

const MAX_HISTORY = 50;
const cloudOwnerKey = 'blocklens_ai_history_cloud_user';

const isAIAnalysis = (value: unknown): value is AIAnalysis => {
  if (!value || typeof value !== 'object') return false;
  const analysis = value as AIAnalysis;
  return typeof analysis.headline === 'string'
    && typeof analysis.summary === 'string'
    && ['bullish', 'neutral', 'bearish'].includes(analysis.stance)
    && typeof analysis.confidence === 'number'
    && Number.isFinite(analysis.confidence)
    && ['low', 'medium', 'high'].includes(analysis.risk)
    && typeof analysis.timeframe === 'string'
    && Array.isArray(analysis.supportLevels)
    && Array.isArray(analysis.resistanceLevels)
    && typeof analysis.tradeSetup === 'object'
    && Array.isArray(analysis.scenarios)
    && typeof analysis.methodology === 'string'
    && typeof analysis.dataAsOf === 'string'
    && typeof analysis.generatedAt === 'string';
};

const isAIHistory = (value: unknown): value is AIAnalysisHistoryEntry[] => (
  Array.isArray(value) && value.length <= MAX_HISTORY && value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const entry = item as AIAnalysisHistoryEntry;
    return typeof entry.id === 'string'
      && /^[a-zA-Z0-9-]{1,120}$/.test(entry.id)
      && typeof entry.coinId === 'string'
      && /^[a-z0-9-]{1,100}$/.test(entry.coinId)
      && typeof entry.coinName === 'string'
      && typeof entry.coinSymbol === 'string'
      && ['usd', 'eur', 'gbp', 'ngn'].includes(entry.currency)
      && typeof entry.price === 'number'
      && Number.isFinite(entry.price)
      && entry.price >= 0
      && isAIAnalysis(entry.analysis)
      && typeof entry.createdAt === 'string';
  })
);

const createId = () => {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* Use the fallback below when crypto is unavailable. */ }
  return `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const toHistoryEntry = (row: {
  id: string;
  coin_id: string;
  coin_name: string;
  coin_symbol: string;
  currency: string;
  price: number;
  analysis: Json;
  created_at: string;
}): AIAnalysisHistoryEntry | null => {
  if (!isAIAnalysis(row.analysis)) return null;
  return {
    id: row.id,
    coinId: row.coin_id,
    coinName: row.coin_name,
    coinSymbol: row.coin_symbol,
    currency: row.currency as CurrencyCode,
    price: Number(row.price),
    analysis: row.analysis,
    createdAt: row.created_at,
  };
};

export const useAIHistory = () => {
  const { user } = useAuth();
  const [history, setHistory] = usePersistentState<AIAnalysisHistoryEntry[]>(
    'blocklens_ai_history',
    [],
    isAIHistory,
  );
  const historyRef = useRef(history);
  const cloudReady = useRef(false);
  const pendingCreates = useRef<AIAnalysisHistoryEntry[]>([]);

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
        .from('ai_analysis_history')
        .select('id, coin_id, coin_name, coin_symbol, currency, price, analysis, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(MAX_HISTORY);
      if (cancelled || error || !data) return;

      const remote = data.map(toHistoryEntry).filter((entry): entry is AIAnalysisHistoryEntry => Boolean(entry));
      let previousOwner: string | null = null;
      try { previousOwner = window.localStorage.getItem(cloudOwnerKey); } catch { /* Storage can be unavailable. */ }
      const canMigrateLocal = !previousOwner || previousOwner === user.id;
      const byId = new Map<string, AIAnalysisHistoryEntry>();
      (remote.length > 0 || !canMigrateLocal ? remote : historyRef.current).forEach((entry) => byId.set(entry.id, entry));
      pendingCreates.current.forEach((entry) => byId.set(entry.id, entry));
      const resolved = [...byId.values()]
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .slice(0, MAX_HISTORY);
      historyRef.current = resolved;
      setHistory(resolved);
      cloudReady.current = true;
      try { window.localStorage.setItem(cloudOwnerKey, user.id); } catch { /* Storage can be unavailable. */ }

      const remoteIds = new Set(remote.map((entry) => entry.id));
      const localOnly = resolved.filter((entry) => !remoteIds.has(entry.id));
      if (localOnly.length > 0) {
        await client.from('ai_analysis_history').upsert(localOnly.map((entry) => ({
          id: entry.id,
          user_id: user.id,
          coin_id: entry.coinId,
          coin_name: entry.coinName,
          coin_symbol: entry.coinSymbol,
          currency: entry.currency,
          price: entry.price,
          analysis: entry.analysis as unknown as Json,
          created_at: entry.createdAt,
        })), { onConflict: 'id' });
      }
      pendingCreates.current = [];
    };

    void loadCloudHistory();
    return () => { cancelled = true; };
  }, [setHistory, user]);

  const saveAnalysis = useCallback((input: Omit<AIAnalysisHistoryEntry, 'id' | 'createdAt'>) => {
    const entry: AIAnalysisHistoryEntry = { ...input, id: createId(), createdAt: new Date().toISOString() };
    const next = [entry, ...historyRef.current].slice(0, MAX_HISTORY);
    historyRef.current = next;
    setHistory(next);
    if (!supabase || !user) return;
    if (!cloudReady.current) {
      pendingCreates.current.push(entry);
      return;
    }
    void supabase.from('ai_analysis_history').upsert({
      id: entry.id,
      user_id: user.id,
      coin_id: entry.coinId,
      coin_name: entry.coinName,
      coin_symbol: entry.coinSymbol,
      currency: entry.currency,
      price: entry.price,
      analysis: entry.analysis as unknown as Json,
      created_at: entry.createdAt,
    }, { onConflict: 'id' });
  }, [setHistory, user]);

  return { history, saveAnalysis };
};
