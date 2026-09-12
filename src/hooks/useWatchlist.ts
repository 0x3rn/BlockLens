import { useCallback, useEffect, useRef, useState } from 'react';
import { usePersistentState } from './usePersistentState';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

const isStringArray = (value: unknown): value is string[] => (
  Array.isArray(value)
  && value.length <= 500
  && value.every((item) => typeof item === 'string' && /^[a-z0-9-]{1,100}$/.test(item))
);

export type WatchlistSyncStatus = 'local' | 'loading' | 'ready' | 'error';

export type WatchlistMutationResult =
  | { ok: true; action: 'added' | 'removed' }
  | { ok: false; error: string };

const loadErrorMessage = 'Your saved watchlist could not be loaded. Retry account sync before making changes.';
const saveErrorMessage = 'That watchlist change was not saved. Your existing saved watchlist is unchanged.';

export const useWatchlist = () => {
  const { user, loading: authLoading } = useAuth();
  const client = supabase;
  const [watchlist, setWatchlist] = usePersistentState<string[]>(
    'blocklens_watchlist',
    [],
    isStringArray,
    !authLoading && !user,
  );
  const [syncStatus, setSyncStatus] = useState<WatchlistSyncStatus>(authLoading || user ? 'loading' : 'local');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const watchlistRef = useRef(watchlist);
  const cloudReady = useRef(false);

  useEffect(() => {
    watchlistRef.current = watchlist;
  }, [watchlist]);

  useEffect(() => {
    let cancelled = false;
    cloudReady.current = false;

    if (authLoading) {
      setSyncStatus('loading');
      return () => { cancelled = true; };
    }
    if (!client || !user) {
      setSyncStatus('local');
      setSyncError(null);
      return () => { cancelled = true; };
    }

    setSyncStatus('loading');
    setSyncError(null);
    const loadCloudWatchlist = async () => {
      const { data, error } = await client
        .from('watchlist_items')
        .select('coin_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (error) {
        setSyncStatus('error');
        setSyncError(loadErrorMessage);
        return;
      }

      const remoteIds = [...new Set((data ?? []).map((item) => item.coin_id).filter((id) => /^[a-z0-9-]{1,100}$/.test(id)))];
      watchlistRef.current = remoteIds;
      setWatchlist(remoteIds);
      cloudReady.current = true;
      setSyncStatus('ready');
    };

    void loadCloudWatchlist();
    return () => { cancelled = true; };
  }, [authLoading, client, loadVersion, setWatchlist, user]);

  const toggleWatchlist = useCallback(async (id: string): Promise<WatchlistMutationResult> => {
    if (!/^[a-z0-9-]{1,100}$/.test(id)) return { ok: false, error: 'That asset cannot be saved.' };
    const removing = watchlistRef.current.includes(id);
    const next = removing
      ? watchlistRef.current.filter((coinId) => coinId !== id)
      : [...new Set([...watchlistRef.current, id])];

    if (!client || !user) {
      watchlistRef.current = next;
      setWatchlist(next);
      return { ok: true, action: removing ? 'removed' : 'added' };
    }
    if (!cloudReady.current) {
      return { ok: false, error: syncError ?? 'Your account watchlist is still loading. Try again in a moment.' };
    }

    const result = removing
      ? await client.from('watchlist_items').delete().eq('user_id', user.id).eq('coin_id', id)
      : await client.from('watchlist_items').upsert({ user_id: user.id, coin_id: id }, { onConflict: 'user_id,coin_id' });
    if (result.error) {
      setSyncError(saveErrorMessage);
      return { ok: false, error: saveErrorMessage };
    }

    watchlistRef.current = next;
    setWatchlist(next);
    setSyncError(null);
    return { ok: true, action: removing ? 'removed' : 'added' };
  }, [client, setWatchlist, syncError, user]);

  const retryWatchlistSync = useCallback(() => {
    setLoadVersion((version) => version + 1);
  }, []);

  return { watchlist, toggleWatchlist, syncStatus, syncError, retryWatchlistSync };
};
