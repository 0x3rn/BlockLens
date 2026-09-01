import { useCallback, useEffect, useRef } from 'react';
import { usePersistentState } from './usePersistentState';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const isStringArray = (value: unknown): value is string[] => (
  Array.isArray(value)
  && value.length <= 500
  && value.every((item) => typeof item === 'string' && /^[a-z0-9-]{1,100}$/.test(item))
);

export const useWatchlist = () => {
  const { user } = useAuth();
  const [watchlist, setWatchlist] = usePersistentState<string[]>(
    'blocklens_watchlist',
    [],
    isStringArray,
  );
  const cloudReady = useRef(false);

  useEffect(() => {
    let cancelled = false;
    cloudReady.current = false;
    if (!supabase || !user) return undefined;
    void supabase.from('watchlist_items').select('coin_id').eq('user_id', user.id).order('created_at', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setWatchlist((data ?? []).map((item) => item.coin_id));
        cloudReady.current = true;
      });
    return () => { cancelled = true; };
  }, [setWatchlist, user]);

  const toggleWatchlist = useCallback((id: string) => {
    setWatchlist((previous) => {
      const removing = previous.includes(id);
      const next = removing ? previous.filter((coinId) => coinId !== id) : [...new Set([...previous, id])];
      if (supabase && user && cloudReady.current) {
        void (removing
          ? supabase.from('watchlist_items').delete().eq('user_id', user.id).eq('coin_id', id)
          : supabase.from('watchlist_items').upsert({ user_id: user.id, coin_id: id }, { onConflict: 'user_id,coin_id' }));
      }
      return next;
    });
  }, [setWatchlist, user]);

  return { watchlist, toggleWatchlist, clearWatchlist: () => setWatchlist([]) };
};
