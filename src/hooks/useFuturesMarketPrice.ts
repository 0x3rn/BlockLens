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

export const useFuturesMarketPrice = (coin: Coin | null) => {
  const [price, setPrice] = useState(coin?.current_price ?? 0);
  const [priceCoinId, setPriceCoinId] = useState<string | null>(coin?.id ?? null);
  const [status, setStatus] = useState<FuturesPriceStatus>('connecting');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  const [connectionKey, setConnectionKey] = useState(0);
  const snapshot = useRef(coin?.current_price ?? 0);
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

  return { price, priceCoinId, status, lastUpdated, fundingRate, retry };
};
