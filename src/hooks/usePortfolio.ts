import { useCallback } from 'react';
import { PortfolioPosition } from '../types/crypto';
import { usePersistentState } from './usePersistentState';

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
  const [positions, setPositions] = usePersistentState<PortfolioPosition[]>(
    'blocklens_portfolio',
    [],
    isPortfolio,
  );

  const upsertPosition = useCallback((position: Omit<PortfolioPosition, 'updatedAt'>) => {
    setPositions((previous) => {
      const next = previous.filter((item) => item.coinId !== position.coinId);
      if (position.quantity <= 0) return next;
      return [...next, { ...position, updatedAt: new Date().toISOString() }];
    });
  }, [setPositions]);

  const removePosition = useCallback((coinId: string) => {
    setPositions((previous) => previous.filter((item) => item.coinId !== coinId));
  }, [setPositions]);

  return { positions, upsertPosition, removePosition };
};
