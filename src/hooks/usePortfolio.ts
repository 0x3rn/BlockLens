import { useCallback, useEffect, useRef } from 'react';
import { CurrencyCode, PortfolioPosition } from '../types/crypto';
import { usePersistentState } from './usePersistentState';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const isPortfolio = (value: unknown): value is PortfolioPosition[] => (
  Array.isArray(value) && value.length <= 500 && value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const position = item as PortfolioPosition;
    return typeof position.coinId === 'string'
      && /^[a-z0-9-]{1,100}$/.test(position.coinId)
      && typeof position.quantity === 'number'
      && Number.isFinite(position.quantity)
      && position.quantity >= 0
      && typeof position.averageCost === 'number'
      && Number.isFinite(position.averageCost)
      && position.averageCost >= 0
      && typeof position.currency === 'string'
      && ['usd', 'eur', 'gbp', 'ngn'].includes(position.currency)
      && typeof position.updatedAt === 'string';
  })
);

export const usePortfolio = () => {
  const { user } = useAuth();
  const [positions, setPositions] = usePersistentState<PortfolioPosition[]>(
    'blocklens_portfolio',
    [],
    isPortfolio,
  );
  const portfolioIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    portfolioIdRef.current = null;
    const client = supabase;
    if (!client || !user) return undefined;

    const loadCloudPortfolio = async () => {
      const { data: portfolio } = await client
        .from('portfolios')
        .select('id')
        .eq('user_id', user.id)
        .eq('name', 'Main portfolio')
        .maybeSingle();
      if (cancelled) return;

      let portfolioId = portfolio?.id as string | undefined;
      if (!portfolioId) {
        const { data: created } = await client
          .from('portfolios')
          .insert({ user_id: user.id, name: 'Main portfolio', base_currency: 'usd' })
          .select('id')
          .single();
        portfolioId = created?.id as string | undefined;
      }
      if (!portfolioId || cancelled) return;
      portfolioIdRef.current = portfolioId;

      const { data: rows } = await client
        .from('portfolio_positions')
        .select('coin_id, quantity, average_cost, currency, updated_at')
        .eq('portfolio_id', portfolioId)
        .order('updated_at', { ascending: false });
      if (cancelled || !rows) return;
      setPositions(rows.map((row) => ({
        coinId: row.coin_id,
        quantity: Number(row.quantity),
        averageCost: Number(row.average_cost),
        currency: row.currency as CurrencyCode,
        updatedAt: row.updated_at,
      })));
    };

    void loadCloudPortfolio();
    return () => { cancelled = true; };
  }, [setPositions, user]);

  const upsertPosition = useCallback((position: Omit<PortfolioPosition, 'updatedAt'>) => {
    const updatedAt = new Date().toISOString();
    setPositions((previous) => {
      const next = previous.filter((item) => item.coinId !== position.coinId);
      if (position.quantity <= 0) return next;
      return [...next, { ...position, updatedAt }];
    });
    const portfolioId = portfolioIdRef.current;
    if (!supabase || !user || !portfolioId) return;
    void (position.quantity <= 0
      ? supabase.from('portfolio_positions').delete().eq('portfolio_id', portfolioId).eq('coin_id', position.coinId)
      : supabase.from('portfolio_positions').upsert({
        portfolio_id: portfolioId,
        coin_id: position.coinId,
        quantity: position.quantity,
        average_cost: position.averageCost,
        currency: position.currency,
        updated_at: updatedAt,
      }, { onConflict: 'portfolio_id,coin_id' }));
  }, [setPositions, user]);

  const removePosition = useCallback((coinId: string) => {
    setPositions((previous) => previous.filter((item) => item.coinId !== coinId));
    const portfolioId = portfolioIdRef.current;
    if (supabase && user && portfolioId) {
      void supabase.from('portfolio_positions').delete().eq('portfolio_id', portfolioId).eq('coin_id', coinId);
    }
  }, [setPositions, user]);

  return { positions, upsertPosition, removePosition };
};
