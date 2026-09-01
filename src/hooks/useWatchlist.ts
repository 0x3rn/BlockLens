import { useCallback, useEffect, useRef } from 'react';
import { usePersistentState } from './usePersistentState';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const isStringArray = (value: unknown): value is string[] => (
  Array.isArray(value)
  && value.length <= 500
  && value.every((item) => typeof item === 'string' && /^[a-z0-9-]{1,100}$/.test(item))
);
const cloudOwnerKey = 'blocklens_watchlist_cloud_user';

export const useWatchlist = () => {
  const { user } = useAuth();
  const client = supabase;
  const [watchlist, setWatchlist] = usePersistentState<string[]>(
    'blocklens_watchlist',
    [],
    isStringArray,
  );
  const cloudReady = useRef(false);
  const watchlistRef = useRef(watchlist);
  const pendingChanges = useRef(new Map<string, boolean>());

  useEffect(() => {
    watchlistRef.current = watchlist;
  }, [watchlist]);

  useEffect(() => {
    let cancelled = false;
    cloudReady.current = false;
    pendingChanges.current.clear();
    if (!client || !user) return undefined;

    const loadCloudWatchlist = async () => {
      const { data, error } = await client
        .from('watchlist_items')
        .select('coin_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (cancelled || error) return;

      const remoteIds = (data ?? []).map((item) => item.coin_id);
      let previousOwner: string | null = null;
      try { previousOwner = window.localStorage.getItem(cloudOwnerKey); } catch { /* Storage can be unavailable. */ }
      const canMigrateLocal = !previousOwner || previousOwner === user.id;
      const nextIds = new Set(remoteIds.length > 0 || !canMigrateLocal ? remoteIds : watchlistRef.current);
      pendingChanges.current.forEach((added, id) => {
        if (added) nextIds.add(id);
        else nextIds.delete(id);
      });
      const resolvedIds = [...nextIds];
      watchlistRef.current = resolvedIds;
      setWatchlist(resolvedIds);
      cloudReady.current = true;
      try { window.localStorage.setItem(cloudOwnerKey, user.id); } catch { /* Storage can be unavailable. */ }

      const remoteSet = new Set(remoteIds);
      const addedIds = resolvedIds.filter((id) => !remoteSet.has(id));
      const removedIds = remoteIds.filter((id) => !nextIds.has(id));
      if (removedIds.length > 0) {
        await client.from('watchlist_items').delete().eq('user_id', user.id).in('coin_id', removedIds);
      }
      if (addedIds.length > 0) {
        await client.from('watchlist_items').upsert(
          addedIds.map((coin_id) => ({ user_id: user.id, coin_id })),
          { onConflict: 'user_id,coin_id' },
        );
      }
    };

    void loadCloudWatchlist();
    return () => { cancelled = true; };
  }, [setWatchlist, user]);

  const toggleWatchlist = useCallback((id: string) => {
    const removing = watchlistRef.current.includes(id);
    const next = removing ? watchlistRef.current.filter((coinId) => coinId !== id) : [...new Set([...watchlistRef.current, id])];
    watchlistRef.current = next;
    setWatchlist(next);
    if (client && user) {
      if (!cloudReady.current) pendingChanges.current.set(id, !removing);
      else void (removing
        ? client.from('watchlist_items').delete().eq('user_id', user.id).eq('coin_id', id)
        : client.from('watchlist_items').upsert({ user_id: user.id, coin_id: id }, { onConflict: 'user_id,coin_id' }));
    }
  }, [setWatchlist, user]);

  const clearWatchlist = useCallback(() => {
    const previous = watchlistRef.current;
    watchlistRef.current = [];
    setWatchlist([]);
    if (client && user) {
      if (!cloudReady.current) previous.forEach((id) => pendingChanges.current.set(id, false));
      else void client.from('watchlist_items').delete().eq('user_id', user.id);
    }
  }, [setWatchlist, user]);

  return { watchlist, toggleWatchlist, clearWatchlist };
};
