import { useCallback, useEffect, useRef, useState } from 'react';
import { usePersistentState } from './usePersistentState';
import { useAuth } from '../context/AuthContext';
import { database } from '../lib/database';

const isStringArray = (value: unknown): value is string[] => (
  Array.isArray(value)
  && value.length <= 500
  && value.every((item) => typeof item === 'string' && /^[a-z0-9-]{1,100}$/.test(item))
);

export type WatchlistSyncStatus = 'local' | 'loading' | 'ready' | 'error';

export type WatchlistMutationResult =
  | { ok: true; action: 'added' | 'removed' }
  | { ok: false; error: string };

const loadErrorMessage = 'Your watchlist could not be loaded. Please try again.';
const saveErrorMessage = 'Your watchlist change could not be saved. Please try again.';

export const useWatchlist = () => {
  const { user, loading: authLoading } = useAuth();
  const client = database;
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
  const sessionVersion = useRef(0);
  const pendingChanges = useRef(new Map<string, Promise<WatchlistMutationResult>>());
  const userId = user?.id;

  useEffect(() => {
    watchlistRef.current = watchlist;
  }, [watchlist]);

  useEffect(() => {
    let cancelled = false;
    sessionVersion.current += 1;
    pendingChanges.current.clear();
    cloudReady.current = false;
    const cancel = () => {
      cancelled = true;
      sessionVersion.current += 1;
      cloudReady.current = false;
      pendingChanges.current.clear();
    };

    if (authLoading) {
      setSyncStatus('loading');
      return cancel;
    }
    if (!client || !userId) {
      setSyncStatus('local');
      setSyncError(null);
      return cancel;
    }

    setSyncStatus('loading');
    setSyncError(null);
    const loadCloudWatchlist = async () => {
      const { data, error } = await client
        .from('watchlist_items')
        .select('coin_id')
        .eq('user_id', userId)
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
    return cancel;
  }, [authLoading, client, loadVersion, setWatchlist, userId]);

  const toggleWatchlist = useCallback(async (id: string): Promise<WatchlistMutationResult> => {
    if (!/^[a-z0-9-]{1,100}$/.test(id)) return { ok: false, error: 'That asset cannot be saved.' };
    if (authLoading) return { ok: false, error: 'Please wait a moment and try again.' };
    const pending = pendingChanges.current.get(id);
    if (pending) return pending;
    const removing = watchlistRef.current.includes(id);
    const applyChange = () => {
      // Merge each confirmed change into the latest list, including other completed saves.
      const next = removing
        ? watchlistRef.current.filter((coinId) => coinId !== id)
        : [...new Set([...watchlistRef.current, id])];
      watchlistRef.current = next;
      setWatchlist(next);
    };

    if (!client || !userId) {
      applyChange();
      return { ok: true, action: removing ? 'removed' : 'added' };
    }
    if (!cloudReady.current) {
      return { ok: false, error: syncError ?? 'Your watchlist is loading. Please wait a moment.' };
    }

    const version = sessionVersion.current;
    const change = (async (): Promise<WatchlistMutationResult> => {
      try {
        const result = removing
          ? await client.from('watchlist_items').delete().eq('user_id', userId).eq('coin_id', id)
          : await client.from('watchlist_items').upsert({ user_id: userId, coin_id: id }, { onConflict: 'user_id,coin_id' });
        if (version !== sessionVersion.current) {
          return { ok: false, error: 'Your account changed. Please try again.' };
        }
        if (result.error) {
          setSyncError(saveErrorMessage);
          return { ok: false, error: saveErrorMessage };
        }
        applyChange();
        setSyncError(null);
        return { ok: true, action: removing ? 'removed' : 'added' };
      } catch {
        if (version === sessionVersion.current) setSyncError(saveErrorMessage);
        return { ok: false, error: saveErrorMessage };
      }
    })();
    pendingChanges.current.set(id, change);
    try {
      return await change;
    } finally {
      if (pendingChanges.current.get(id) === change) pendingChanges.current.delete(id);
    }
  }, [authLoading, client, setWatchlist, syncError, userId]);

  const retryWatchlistSync = useCallback(() => {
    setLoadVersion((version) => version + 1);
  }, []);

  return { watchlist, toggleWatchlist, syncStatus, syncError, retryWatchlistSync };
};
