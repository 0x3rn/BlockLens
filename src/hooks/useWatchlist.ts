import { useCallback } from 'react';
import { usePersistentState } from './usePersistentState';

const isStringArray = (value: unknown): value is string[] => (
  Array.isArray(value)
  && value.length <= 500
  && value.every((item) => typeof item === 'string' && /^[a-z0-9-]{1,100}$/.test(item))
);

export const useWatchlist = () => {
  const [watchlist, setWatchlist] = usePersistentState<string[]>(
    'blocklens_watchlist',
    [],
    isStringArray,
  );

  const toggleWatchlist = useCallback((id: string) => {
    setWatchlist((previous) => (
      previous.includes(id)
        ? previous.filter((coinId) => coinId !== id)
        : [...new Set([...previous, id])]
    ));
  }, [setWatchlist]);

  return { watchlist, toggleWatchlist, clearWatchlist: () => setWatchlist([]) };
};
