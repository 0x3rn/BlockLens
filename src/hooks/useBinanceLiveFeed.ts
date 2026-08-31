import { useCallback, useEffect, useRef, useState } from 'react';
import { LiveLiquidation, LiveSpotTrade } from '../types/crypto';

type FeedStatus = 'connecting' | 'live' | 'reconnecting' | 'unavailable';

interface BinanceAggregateTrade {
  a: number;
  p: string;
  q: string;
  T: number;
  m: boolean;
}

interface BinanceLiquidationOrder {
  s: string;
  S: 'BUY' | 'SELL';
  q: string;
  p: string;
  ap: string;
  z: string;
  T: number;
}

interface BinanceLiquidationMessage {
  E: number;
  o: BinanceLiquidationOrder;
  st?: number;
}

const SPOT_STREAM = 'wss://stream.binance.com:9443/ws/btcusdt@aggTrade';
const LIQUIDATION_STREAM = 'wss://fstream.binance.com/market/ws/!forceOrder@arr';
const MAX_ROWS = 10;

export const useBinanceLiveFeed = () => {
  const [trades, setTrades] = useState<LiveSpotTrade[]>([]);
  const [liquidations, setLiquidations] = useState<LiveLiquidation[]>([]);
  const [status, setStatus] = useState<FeedStatus>('connecting');
  const [sessionTotals, setSessionTotals] = useState({ long: 0, short: 0 });
  const [connectionKey, setConnectionKey] = useState(0);
  const retry = useCallback(() => setConnectionKey((value) => value + 1), []);
  const pendingTrades = useRef<LiveSpotTrade[]>([]);
  const pendingLiquidations = useRef<LiveLiquidation[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
      setStatus('unavailable');
      return undefined;
    }

    let active = true;
    let spotSocket: WebSocket | null = null;
    let liquidationSocket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;
    const openStreams = new Set<string>();
    setStatus(connectionKey === 0 ? 'connecting' : 'reconnecting');

    const updateConnectionState = () => {
      if (!active) return;
      setStatus(openStreams.size === 2 ? 'live' : reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    };

    const scheduleReconnect = () => {
      if (!active || reconnectTimer) return;
      reconnectAttempt += 1;
      updateConnectionState();
      const delay = Math.min(1_000 * (2 ** (reconnectAttempt - 1)), 20_000);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (!active) return;
      if (spotSocket) {
        spotSocket.onclose = null;
        spotSocket.close();
      }
      if (liquidationSocket) {
        liquidationSocket.onclose = null;
        liquidationSocket.close();
      }
      openStreams.clear();

      try {
        spotSocket = new WebSocket(SPOT_STREAM);
        liquidationSocket = new WebSocket(LIQUIDATION_STREAM);
      } catch {
        setStatus('unavailable');
        return;
      }

      spotSocket.onopen = () => {
        openStreams.add('spot');
        reconnectAttempt = 0;
        updateConnectionState();
      };
      liquidationSocket.onopen = () => {
        openStreams.add('liquidations');
        reconnectAttempt = 0;
        updateConnectionState();
      };

      spotSocket.onmessage = (event) => {
        try {
          const trade = JSON.parse(String(event.data)) as BinanceAggregateTrade;
          const price = Number(trade.p);
          const quantity = Number(trade.q);
          if (!Number.isFinite(price) || !Number.isFinite(quantity)) return;
          pendingTrades.current.unshift({
            id: String(trade.a),
            timestamp: trade.T,
            price,
            quantity,
            quoteValue: price * quantity,
            side: trade.m ? 'sell' : 'buy',
          });
        } catch {
          // Ignore malformed third-party stream messages and keep the connection alive.
        }
      };

      liquidationSocket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as BinanceLiquidationMessage;
          const order = message.o;
          if (!order || message.st === 2) return;
          const price = Number(order.ap || order.p);
          const quantity = Number(order.z || order.q);
          if (!Number.isFinite(price) || !Number.isFinite(quantity)) return;
          const side = order.S === 'SELL' ? 'long' : 'short';
          const quoteValue = price * quantity;
          pendingLiquidations.current.unshift({
            id: `${order.s}-${order.T}-${order.S}`,
            timestamp: order.T || message.E,
            symbol: order.s,
            side,
            price,
            quantity,
            quoteValue,
          });
          setSessionTotals((totals) => ({ ...totals, [side]: totals[side] + quoteValue }));
        } catch {
          // Ignore malformed third-party stream messages and keep the connection alive.
        }
      };

      const handleSpotClose = () => {
        openStreams.delete('spot');
        scheduleReconnect();
      };
      const handleLiquidationClose = () => {
        openStreams.delete('liquidations');
        scheduleReconnect();
      };
      spotSocket.onclose = handleSpotClose;
      liquidationSocket.onclose = handleLiquidationClose;
      spotSocket.onerror = () => spotSocket?.close();
      liquidationSocket.onerror = () => liquidationSocket?.close();
    };

    connect();
    const flushTimer = window.setInterval(() => {
      if (pendingTrades.current.length > 0) {
        const next = pendingTrades.current.splice(0);
        setTrades((current) => [...next, ...current].slice(0, MAX_ROWS));
      }
      if (pendingLiquidations.current.length > 0) {
        const next = pendingLiquidations.current.splice(0);
        setLiquidations((current) => [...next, ...current].slice(0, MAX_ROWS));
      }
    }, 500);

    return () => {
      active = false;
      window.clearInterval(flushTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      spotSocket?.close();
      liquidationSocket?.close();
      pendingTrades.current = [];
      pendingLiquidations.current = [];
    };
  }, [connectionKey]);

  return { trades, liquidations, sessionTotals, status, retry };
};
