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
const cloudOwnerKey = 'blocklens_portfolio_cloud_user';

export const usePortfolio = () => {
  const { user } = useAuth();
  const [positions, setPositions] = usePersistentState<PortfolioPosition[]>(
    'blocklens_portfolio',
    [],
    isPortfolio,
  );
  const portfolioIdRef = useRef<string | null>(null);
  const cloudReady = useRef(false);
  const positionsRef = useRef(positions);
  const pendingChanges = useRef(new Map<string, PortfolioPosition | null>());

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    let cancelled = false;
    portfolioIdRef.current = null;
    cloudReady.current = false;
    pendingChanges.current.clear();
    const client = supabase;
    if (!client || !user) return undefined;

    const loadCloudPortfolio = async () => {
      const { data: portfolio, error: portfolioError } = await client
        .from('portfolios')
        .select('id')
        .eq('user_id', user.id)
        .eq('name', 'Main portfolio')
        .maybeSingle();
      if (cancelled || portfolioError) return;

      let portfolioId = portfolio?.id as string | undefined;
      if (!portfolioId) {
        const { data: created, error: createError } = await client
          .from('portfolios')
          .insert({ user_id: user.id, name: 'Main portfolio', base_currency: 'usd' })
          .select('id')
          .single();
        if (createError) return;
        portfolioId = created?.id as string | undefined;
      }
      if (!portfolioId || cancelled) return;
      portfolioIdRef.current = portfolioId;

      const { data: rows, error: positionsError } = await client
        .from('portfolio_positions')
        .select('coin_id, quantity, average_cost, currency, updated_at')
        .eq('portfolio_id', portfolioId)
        .order('updated_at', { ascending: false });
      if (cancelled || positionsError || !rows) return;

      const remotePositions = rows.map((row) => ({
        coinId: row.coin_id,
        quantity: Number(row.quantity),
        averageCost: Number(row.average_cost),
        currency: row.currency as CurrencyCode,
        updatedAt: row.updated_at,
      }));
      const nextByCoin = new Map<string, PortfolioPosition>();
      let previousOwner: string | null = null;
      try { previousOwner = window.localStorage.getItem(cloudOwnerKey); } catch { /* Storage can be unavailable. */ }
      const canMigrateLocal = !previousOwner || previousOwner === user.id;
      (remotePositions.length > 0 || !canMigrateLocal ? remotePositions : positionsRef.current).forEach((position) => nextByCoin.set(position.coinId, position));
      pendingChanges.current.forEach((position, coinId) => {
        if (position) nextByCoin.set(coinId, position);
        else nextByCoin.delete(coinId);
      });
      const resolvedPositions = [...nextByCoin.values()];
      positionsRef.current = resolvedPositions;
      setPositions(resolvedPositions);
      cloudReady.current = true;
      try { window.localStorage.setItem(cloudOwnerKey, user.id); } catch { /* Storage can be unavailable. */ }

      const resolvedIds = new Set(resolvedPositions.map((position) => position.coinId));
      const removedIds = remotePositions.filter((position) => !resolvedIds.has(position.coinId)).map((position) => position.coinId);
      if (removedIds.length > 0) {
        await client.from('portfolio_positions').delete().eq('portfolio_id', portfolioId).in('coin_id', removedIds);
      }
      if (resolvedPositions.length > 0) {
        await client.from('portfolio_positions').upsert(resolvedPositions.map((position) => ({
          portfolio_id: portfolioId,
          coin_id: position.coinId,
          quantity: position.quantity,
          average_cost: position.averageCost,
          currency: position.currency,
          updated_at: position.updatedAt,
        })), { onConflict: 'portfolio_id,coin_id' });
      }
    };

    void loadCloudPortfolio();
    return () => { cancelled = true; };
  }, [setPositions, user]);

  const upsertPosition = useCallback((position: Omit<PortfolioPosition, 'updatedAt'>) => {
    const updatedAt = new Date().toISOString();
    const nextPosition = position.quantity > 0 ? { ...position, updatedAt } : null;
    const next = positionsRef.current.filter((item) => item.coinId !== position.coinId);
    if (nextPosition) next.push(nextPosition);
    positionsRef.current = next;
    setPositions(next);
    const portfolioId = portfolioIdRef.current;
    if (!supabase || !user) return;
    if (!cloudReady.current || !portfolioId) {
      pendingChanges.current.set(position.coinId, nextPosition);
      return;
    }
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
    positionsRef.current = positionsRef.current.filter((item) => item.coinId !== coinId);
    setPositions(positionsRef.current);
    const portfolioId = portfolioIdRef.current;
    if (!supabase || !user) return;
    if (!cloudReady.current || !portfolioId) {
      pendingChanges.current.set(coinId, null);
      return;
    }
    void supabase.from('portfolio_positions').delete().eq('portfolio_id', portfolioId).eq('coin_id', coinId);
  }, [setPositions, user]);

  return { positions, upsertPosition, removePosition };
};
