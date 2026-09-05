import { useCallback, useEffect, useState } from 'react';
import { Coin } from '../types/crypto';

export const resolveFuturesMarkPrice = (
  coin: Pick<Coin, 'id' | 'current_price'> | null,
  feedCoinId: string | null,
  feedPrice: number,
) => coin && feedCoinId === coin.id && Number.isFinite(feedPrice) && feedPrice > 0
  ? feedPrice
  : coin?.current_price ?? 0;

export type FuturesPriceStatus = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'fallback';

const getStreamSymbol = (coin: Coin) => {
  const base = coin.symbol.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return base ? `${base}usdt` : null;
};

export const useFuturesMarketPrice = (coin: Coin | null) => {
  const [price, setPrice] = useState(coin?.current_price ?? 0);
  const [priceCoinId, setPriceCoinId] = useState<string | null>(coin?.id ?? null);
  const [status, setStatus] = useState<FuturesPriceStatus>('connecting');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  const [connectionKey, setConnectionKey] = useState(0);
  const retry = useCallback(() => setConnectionKey((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let pollingTimer: number | undefined;
    let pollingAbort: AbortController | null = null;
    let attempt = 0;
    const streamSymbol = coin ? getStreamSymbol(coin) : null;
    setPrice(coin?.current_price ?? 0);
    setPriceCoinId(coin?.id ?? null);
    setLastUpdated(null);
    setFundingRate(null);

    if (!coin || !streamSymbol || typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
      setStatus('fallback');
      return undefined;
    }

    const pollMarkPrice = async () => {
      if (!active) return;
      pollingAbort = new AbortController();
      const timeout = window.setTimeout(() => pollingAbort?.abort(), 5_000);
      try {
        const response = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${streamSymbol.toUpperCase()}`, { signal: pollingAbort.signal });
        if (!response.ok) throw new Error('Mark price request failed');
        const payload = await response.json() as { markPrice?: string; time?: number; lastFundingRate?: string };
        const nextPrice = Number(payload.markPrice);
        if (active && Number.isFinite(nextPrice) && nextPrice > 0) {
          setPrice(nextPrice);
          setLastUpdated(payload.time ?? Date.now());
          const nextFundingRate = Number(payload.lastFundingRate);
          if (Number.isFinite(nextFundingRate)) setFundingRate(nextFundingRate);
          setStatus('polling');
        }
      } catch {
        // Keep the last known market value visible while the public fallback is unavailable.
      } finally {
        window.clearTimeout(timeout);
        pollingAbort = null;
        if (active) pollingTimer = window.setTimeout(pollMarkPrice, 10_000);
      }
    };

    const startPolling = () => {
      if (!active || pollingTimer !== undefined) return;
      setStatus('fallback');
      void pollMarkPrice();
    };

    const connect = () => {
      if (!active) return;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      try {
        socket = new WebSocket(`wss://fstream.binance.com/ws/${streamSymbol}@markPrice@1s`);
      } catch {
        setStatus('fallback');
        startPolling();
        return;
      }
      socket.onopen = () => {
        if (!active) return;
        attempt = 0;
        setStatus('live');
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { p?: string; E?: number; r?: string };
          const nextPrice = Number(message.p);
          if (!Number.isFinite(nextPrice) || nextPrice <= 0 || !active) return;
          setPrice(nextPrice);
          setLastUpdated(message.E ?? Date.now());
          const nextFundingRate = Number(message.r);
          if (Number.isFinite(nextFundingRate)) setFundingRate(nextFundingRate);
        } catch {
          // Ignore malformed stream messages and keep the socket alive.
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (!active) return;
        attempt += 1;
        if (attempt >= 3) {
          setStatus('fallback');
          startPolling();
          return;
        }
        setStatus('reconnecting');
        const delay = Math.min(1_000 * (2 ** Math.min(attempt - 1, 4)), 15_000);
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      active = false;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (pollingTimer) window.clearTimeout(pollingTimer);
      pollingAbort?.abort();
      socket?.close();
    };
  }, [coin?.id, coin?.symbol, coin?.current_price, connectionKey]);

  return { price, priceCoinId, status, lastUpdated, fundingRate, retry };
};
