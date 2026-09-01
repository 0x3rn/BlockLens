import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMarketData, fetchMarketMetrics, getApiErrorMessage } from '../services/api';
import { Coin, CurrencyCode, MarketMetrics, PortfolioPosition, PriceAlert, AlertCondition, AIAnalysisHistoryEntry, PositionHistoryEntry } from '../types/crypto';
import { useAlertsState } from './useAlertsState';
import { useCurrency } from '../hooks/useCurrency';
import { usePortfolio } from '../hooks/usePortfolio';
import { useWatchlist } from '../hooks/useWatchlist';
import { useAIHistory } from '../hooks/useAIHistory';
import { usePositionHistory } from '../hooks/usePositionHistory';

interface MarketContextValue {
  coins: Coin[];
  metrics: MarketMetrics | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastUpdated: string | null;
  refresh: () => Promise<void>;
  currency: CurrencyCode;
  setCurrency: React.Dispatch<React.SetStateAction<CurrencyCode>>;
  watchlist: string[];
  toggleWatchlist: (id: string) => void;
  positions: PortfolioPosition[];
  upsertPosition: (position: Omit<PortfolioPosition, 'updatedAt'>) => void;
  removePosition: (coinId: string) => void;
  aiHistory: AIAnalysisHistoryEntry[];
  saveAIAnalysis: (entry: Omit<AIAnalysisHistoryEntry, 'id' | 'createdAt'>) => void;
  positionHistory: PositionHistoryEntry[];
  alerts: PriceAlert[];
  addAlert: (coinId: string, condition: AlertCondition, threshold: number, currency: CurrencyCode) => void;
  removeAlert: (id: string) => void;
}

const MarketContext = createContext<MarketContextValue | null>(null);

export const MarketProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [coins, setCoins] = useState<Coin[]>([]);
  const [metrics, setMetrics] = useState<MarketMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [dataCurrency, setDataCurrency] = useState<CurrencyCode | null>(null);
  const requestVersion = useRef(0);
  const { currency, setCurrency } = useCurrency();
  const { watchlist, toggleWatchlist } = useWatchlist();
  const { positions, upsertPosition: persistPosition, removePosition: persistRemovePosition } = usePortfolio();
  const { history: aiHistory, saveAnalysis: saveAIAnalysis } = useAIHistory();
  const { history: positionHistory, recordPositionEvent } = usePositionHistory();
  const { alerts, addAlert, removeAlert, evaluateAlerts } = useAlertsState(currency);

  const upsertPosition = useCallback((position: Omit<PortfolioPosition, 'updatedAt'>) => {
    const existing = positions.some((item) => item.coinId === position.coinId);
    persistPosition(position);
    recordPositionEvent({
      coinId: position.coinId,
      action: position.quantity > 0 ? (existing ? 'updated' : 'added') : 'removed',
      quantity: Math.max(0, position.quantity),
      averageCost: Math.max(0, position.averageCost),
      currency: position.currency,
    });
  }, [persistPosition, positions, recordPositionEvent]);

  const removePosition = useCallback((coinId: string) => {
    const existing = positions.find((item) => item.coinId === coinId);
    persistRemovePosition(coinId);
    if (existing) {
      recordPositionEvent({
        coinId,
        action: 'removed',
        quantity: existing.quantity,
        averageCost: existing.averageCost,
        currency: existing.currency,
      });
    }
  }, [persistRemovePosition, positions, recordPositionEvent]);

  const loadData = useCallback(async (force = false) => {
    const version = ++requestVersion.current;
    if (force) {
      setRefreshing(true);
    } else if (coins.length === 0) {
      setLoading(true);
    }

    try {
      const [nextCoins, nextMetrics] = await Promise.all([
        fetchMarketData(currency, force),
        fetchMarketMetrics(currency, force),
      ]);
      if (requestVersion.current !== version) return;
      setCoins(nextCoins);
      setMetrics(nextMetrics);
      setDataCurrency(currency);
      setLastUpdated(new Date().toISOString());
      setError(null);
      evaluateAlerts(nextCoins);
    } catch (loadError) {
      if (requestVersion.current !== version) return;
      setError(getApiErrorMessage(loadError));
    } finally {
      if (requestVersion.current === version) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [coins.length, currency, evaluateAlerts]);

  useEffect(() => {
    setError(null);
    void loadData(false);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadData(true);
    }, 60_000);
    return () => {
      requestVersion.current += 1;
      window.clearInterval(interval);
    };
  }, [currency]); // loadData intentionally omitted to avoid resetting the interval after each response.

  const currencyReady = dataCurrency === currency;
  const visibleCoins = currencyReady ? coins : [];
  const visibleMetrics = currencyReady ? metrics : null;

  const value = useMemo<MarketContextValue>(() => ({
    coins: visibleCoins,
    metrics: visibleMetrics,
    loading: loading || !currencyReady,
    refreshing,
    error,
    lastUpdated,
    refresh: () => loadData(true),
    currency,
    setCurrency,
    watchlist,
    toggleWatchlist,
    positions,
    upsertPosition,
    removePosition,
    aiHistory,
    saveAIAnalysis,
    positionHistory,
    alerts,
    addAlert,
    removeAlert,
  }), [
    alerts,
    visibleCoins,
    currency,
    error,
    lastUpdated,
    loadData,
    loading,
    visibleMetrics,
    positions,
    aiHistory,
    saveAIAnalysis,
    positionHistory,
    refreshing,
    removeAlert,
    removePosition,
    setCurrency,
    toggleWatchlist,
    upsertPosition,
    watchlist,
    addAlert,
    currencyReady,
  ]);

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
};

export const useMarket = (): MarketContextValue => {
  const context = useContext(MarketContext);
  if (!context) throw new Error('useMarket must be used inside MarketProvider');
  return context;
};
