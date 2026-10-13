import { useCallback, useEffect, useRef, useState } from 'react';
import { Coin } from '../types/crypto';

export const resolveFuturesMarkPrice = (coin: Pick<Coin, 'id' | 'current_price'> | null, feedCoinId: string | null, feedPrice: number) => (
  coin && feedCoinId === coin.id && Number.isFinite(feedPrice) && feedPrice > 0 ? feedPrice : coin?.current_price ?? 0
);

export type FuturesPriceStatus = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'fallback';
const STALE_FEED_MS = 10_000;

export const getFuturesStream = (coin: Pick<Coin, 'id' | 'symbol'>) => {
  const bundled: Record<string, string> = { 'shiba-inu': '1000shib', pepe: '1000pepe', bonk: '1000bonk', floki: '1000floki', 'sats-ordinals': '1000sats' };
  const base = bundled[coin.id] ?? coin.symbol.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return { symbol: `${base}usdt`, scale: bundled[coin.id] ? 1000 : 1 };
};

export const useFuturesMarketPrice = (
  coin: Coin | null,
  trackedCoins: ReadonlyArray<Pick<Coin, 'id' | 'symbol' | 'current_price'>> = [],
) => {
  const [price, setPrice] = useState(coin?.current_price ?? 0);
  const [priceCoinId, setPriceCoinId] = useState<string | null>(coin?.id ?? null);
  const [status, setStatus] = useState<FuturesPriceStatus>('connecting');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  const [connectionKey, setConnectionKey] = useState(0);
  const [extraPrices, setExtraPrices] = useState<ReadonlyMap<string, number>>(() => new Map());
  const snapshot = useRef(coin?.current_price ?? 0);
  const latestByCoin = useRef<Map<string, number>>(new Map());
  const retry = useCallback(() => setConnectionKey(value => value + 1), []);

  useEffect(() => {
    snapshot.current = coin?.current_price ?? 0;
    if (status === 'fallback') setPrice(snapshot.current);
  }, [coin?.id, coin?.current_price, status]);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let pollingTimer: number | undefined;
    let watchdog: number | undefined;
    let pollingAbort: AbortController | null = null;
    let polling = false;
    let live = false;
    let unsupported = false;
    let attempt = 0;
    const stream = coin ? getFuturesStream(coin) : null;
    setPrice(snapshot.current);
    setPriceCoinId(coin?.id ?? null);
    setLastUpdated(null);
    setFundingRate(null);
    if (!coin || !stream || typeof window.WebSocket === 'undefined') {
      setStatus('fallback');
      return undefined;
    }

    const poll = async () => {
      if (!active || live || unsupported) return;
      const controller = new AbortController();
      pollingAbort = controller;
      const timeout = window.setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${stream.symbol.toUpperCase()}`, { signal: controller.signal });
        const payload = await response.json() as { markPrice?: string; time?: number; lastFundingRate?: string; code?: number; symbol?: string };
        if (payload.code === -1121) unsupported = true;
        if (!response.ok) throw new Error('Mark price unavailable');
        const next = Number(payload.markPrice) / stream.scale;
        if (!active || live) return;
        if (!Number.isFinite(next) || next <= 0 || payload.symbol !== stream.symbol.toUpperCase()) throw new Error('Invalid mark price');
        latestByCoin.current.set(coin.id, next);
        setPrice(next);
        setLastUpdated(payload.time ?? Date.now());
        const rate = Number(payload.lastFundingRate);
        setFundingRate(Number.isFinite(rate) ? rate : null);
        setStatus('polling');
      } catch {
        if (active && !live) {
          setStatus('fallback');
          setPrice(snapshot.current);
          setLastUpdated(null);
          setFundingRate(null);
        }
      } finally {
        window.clearTimeout(timeout);
        if (pollingAbort === controller) pollingAbort = null;
        if (active && !live && !unsupported) pollingTimer = window.setTimeout(poll, 10_000);
        else polling = false;
      }
    };
    const startPolling = () => {
      if (!active || polling || unsupported) return;
      polling = true;
      setStatus('fallback');
      void poll();
    };
    const stopPolling = () => {
      window.clearTimeout(pollingTimer);
      pollingTimer = undefined;
      pollingAbort?.abort();
      polling = false;
    };
    const armWatchdog = (current: WebSocket) => {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => {
        if (!active || socket !== current) return;
        live = false;
        startPolling();
        current.close();
      }, STALE_FEED_MS);
    };
    const connect = () => {
      if (!active || unsupported) return;
      setStatus(current => current === 'polling' ? current : attempt === 0 ? 'connecting' : 'reconnecting');
      let current: WebSocket;
      try {
        current = new WebSocket(`wss://fstream.binance.com/market/ws/${stream.symbol}@markPrice@1s`);
        socket = current;
      } catch {
        startPolling();
        return;
      }
      armWatchdog(current);
      current.onopen = () => { if (active && socket === current) armWatchdog(current); };
      current.onmessage = event => {
        if (!active || socket !== current) return;
        try {
          const message = JSON.parse(String(event.data)) as { e?: string; s?: string; p?: string; E?: number; r?: string };
          const next = Number(message.p) / stream.scale;
          if (message.e !== 'markPriceUpdate' || message.s !== stream.symbol.toUpperCase() || !Number.isFinite(next) || next <= 0) return;
          if (message.E != null && Date.now() - message.E > STALE_FEED_MS) return;
          live = true;
          attempt = 0;
          stopPolling();
          latestByCoin.current.set(coin.id, next);
          setPrice(next);
          setLastUpdated(message.E ?? Date.now());
          const rate = Number(message.r);
          setFundingRate(Number.isFinite(rate) ? rate : null);
          setStatus('live');
          armWatchdog(current);
        } catch { /* Ignore malformed messages without extending feed freshness. */ }
      };
      current.onerror = () => current.close();
      current.onclose = () => {
        if (!active || socket !== current) return;
        window.clearTimeout(watchdog);
        live = false;
        startPolling();
        attempt += 1;
        if (attempt < 3 && !unsupported) retryTimer = window.setTimeout(connect, 1000 * 2 ** (attempt - 1));
      };
    };
    connect();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
      window.clearTimeout(watchdog);
      stopPolling();
      socket?.close();
    };
  }, [coin?.id, coin?.symbol, connectionKey]);

  const trackedKey = trackedCoins
    .filter(item => item.id !== coin?.id)
    .map(item => `${item.id}:${item.symbol}`)
    .sort()
    .join('|');

  useEffect(() => {
    const targets = trackedCoins.filter(item => item.id !== coin?.id);
    if (targets.length === 0 || typeof window.WebSocket === 'undefined') {
      setExtraPrices(current => current.size === 0 ? current : new Map());
      return undefined;
    }
    let active = true;
    const sockets: WebSocket[] = [];
    const timers = new Set<number>();
    const controllers = new Set<AbortController>();
    const publish = (coinId: string, nextPrice: number) => {
      if (!active || !Number.isFinite(nextPrice) || nextPrice <= 0) return;
      latestByCoin.current.set(coinId, nextPrice);
      setExtraPrices(previous => {
        if (previous.get(coinId) === nextPrice) return previous;
        const next = new Map(previous);
        next.set(coinId, nextPrice);
        return next;
      });
    };

    setExtraPrices(() => {
      const seeded = new Map<string, number>();
      targets.forEach(target => {
        const cached = latestByCoin.current.get(target.id);
        if (cached && Number.isFinite(cached) && cached > 0) seeded.set(target.id, cached);
      });
      return seeded;
    });

    targets.forEach(target => {
      const stream = getFuturesStream(target);
      let socket: WebSocket | null = null;
      let live = false;
      let unsupported = false;
      let polling = false;
      let watchdog: number | undefined;
      let pollTimer: number | undefined;

      const poll = async () => {
        if (!active || live || unsupported) return;
        const controller = new AbortController();
        controllers.add(controller);
        const timeout = window.setTimeout(() => controller.abort(), 5_000);
        timers.add(timeout);
        try {
          const response = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${stream.symbol.toUpperCase()}`, { signal: controller.signal });
          const payload = await response.json() as { markPrice?: string; code?: number; symbol?: string };
          if (payload.code === -1121) unsupported = true;
          if (!response.ok) return;
          const next = Number(payload.markPrice) / stream.scale;
          if (Number.isFinite(next) && next > 0 && payload.symbol === stream.symbol.toUpperCase()) {
            publish(target.id, next);
          }
        } catch {
          // Keep existing snapshot/cached mark price when background poll fails.
        } finally {
          window.clearTimeout(timeout);
          timers.delete(timeout);
          controllers.delete(controller);
          if (active && !live && !unsupported) {
            pollTimer = window.setTimeout(poll, 10_000);
            timers.add(pollTimer);
          } else {
            polling = false;
          }
        }
      };

      const startPolling = () => {
        if (!active || polling || unsupported) return;
        polling = true;
        void poll();
      };

      const armWatchdog = (current: WebSocket) => {
        if (watchdog) {
          window.clearTimeout(watchdog);
          timers.delete(watchdog);
        }
        watchdog = window.setTimeout(() => {
          timers.delete(watchdog!);
          if (!active || socket !== current) return;
          live = false;
          startPolling();
          current.close();
        }, STALE_FEED_MS);
        timers.add(watchdog);
      };

      try {
        const current = new WebSocket(`wss://fstream.binance.com/market/ws/${stream.symbol}@markPrice@1s`);
        socket = current;
        sockets.push(current);
        armWatchdog(current);
        current.onopen = () => { if (active && socket === current) armWatchdog(current); };
        current.onmessage = event => {
          if (!active || socket !== current) return;
          try {
            const message = JSON.parse(String(event.data)) as { e?: string; s?: string; p?: string; E?: number };
            const next = Number(message.p) / stream.scale;
            if (message.e !== 'markPriceUpdate' || message.s !== stream.symbol.toUpperCase() || !Number.isFinite(next) || next <= 0) return;
            if (message.E != null && Date.now() - message.E > STALE_FEED_MS) return;
            live = true;
            if (pollTimer) {
              window.clearTimeout(pollTimer);
              timers.delete(pollTimer);
              pollTimer = undefined;
            }
            polling = false;
            publish(target.id, next);
            armWatchdog(current);
          } catch { /* Ignore malformed messages. */ }
        };
        current.onerror = () => current.close();
        current.onclose = () => {
          if (!active || socket !== current) return;
          if (watchdog) {
            window.clearTimeout(watchdog);
            timers.delete(watchdog);
          }
          live = false;
          startPolling();
        };
      } catch {
        startPolling();
      }
    });

    return () => {
      active = false;
      timers.forEach(timer => window.clearTimeout(timer));
      controllers.forEach(controller => controller.abort());
      sockets.forEach(socket => socket.close());
    };
  }, [coin?.id, connectionKey, trackedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { price, priceCoinId, extraPrices, status, lastUpdated, fundingRate, retry };
};
