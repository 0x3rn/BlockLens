import { useCallback, useEffect, useState } from 'react';
import { Coin } from '../types/crypto';

export type FuturesPriceStatus = 'connecting' | 'live' | 'reconnecting' | 'fallback';

const getStreamSymbol = (coin: Coin) => {
  const base = coin.symbol.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return base ? `${base}usdt` : null;
};

export const useFuturesMarketPrice = (coin: Coin | null) => {
  const [price, setPrice] = useState(coin?.current_price ?? 0);
  const [status, setStatus] = useState<FuturesPriceStatus>('connecting');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [connectionKey, setConnectionKey] = useState(0);
  const retry = useCallback(() => setConnectionKey((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let attempt = 0;
    const streamSymbol = coin ? getStreamSymbol(coin) : null;
    setPrice(coin?.current_price ?? 0);
    setLastUpdated(null);

    if (!coin || !streamSymbol || typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
      setStatus('fallback');
      return undefined;
    }

    const connect = () => {
      if (!active) return;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      try {
        socket = new WebSocket(`wss://fstream.binance.com/ws/${streamSymbol}@markPrice@1s`);
      } catch {
        setStatus('fallback');
        return;
      }
      socket.onopen = () => {
        if (!active) return;
        attempt = 0;
        setStatus('live');
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { p?: string; E?: number };
          const nextPrice = Number(message.p);
          if (!Number.isFinite(nextPrice) || nextPrice <= 0 || !active) return;
          setPrice(nextPrice);
          setLastUpdated(message.E ?? Date.now());
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
      socket?.close();
    };
  }, [coin?.id, coin?.symbol, coin?.current_price, connectionKey]);

  return { price, status, lastUpdated, retry };
};
