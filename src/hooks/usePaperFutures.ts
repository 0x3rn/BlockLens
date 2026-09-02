import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Json, supabase } from '../lib/supabase';
import {
  FuturesSide,
  PaperFuturesAccount,
  PaperFuturesPosition,
  PaperFuturesTrade,
  PaperFuturesTradeAction,
} from '../types/crypto';

export const STARTING_FUTURES_BALANCE = 10_000;
export const FUTURES_TAKER_FEE = 0.0004;
export const MAX_FUTURES_LEVERAGE = 25;

const MAX_POSITIONS = 20;
const MAX_TRADES = 200;
const futuresStorageKey = 'blocklens_paper_futures';

export interface OpenFuturesPositionInput {
  coinId: string;
  coinName: string;
  symbol: string;
  side: FuturesSide;
  price: number;
  margin: number;
  leverage: number;
  stopLoss: number | null;
  takeProfit: number | null;
}

export interface FuturesActionResult {
  ok: boolean;
  message: string;
  position?: PaperFuturesPosition;
  trade?: PaperFuturesTrade;
}

export type PaperFuturesSyncStatus = 'loading' | 'ready' | 'saving' | 'error';

export const createInitialPaperFuturesAccount = (): PaperFuturesAccount => ({
  balance: STARTING_FUTURES_BALANCE,
  realizedPnl: 0,
  positions: [],
  trades: [],
  updatedAt: new Date().toISOString(),
});

const isFiniteNonNegative = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
);

const isPosition = (value: unknown): value is PaperFuturesPosition => {
  if (!value || typeof value !== 'object') return false;
  const position = value as PaperFuturesPosition;
  return typeof position.id === 'string'
    && typeof position.coinId === 'string'
    && typeof position.coinName === 'string'
    && typeof position.symbol === 'string'
    && ['long', 'short'].includes(position.side)
    && isFiniteNonNegative(position.quantity)
    && position.quantity > 0
    && typeof position.entryPrice === 'number'
    && Number.isFinite(position.entryPrice)
    && position.entryPrice > 0
    && isFiniteNonNegative(position.margin)
    && position.margin > 0
    && typeof position.leverage === 'number'
    && Number.isFinite(position.leverage)
    && position.leverage >= 1
    && position.leverage <= MAX_FUTURES_LEVERAGE
    && (position.stopLoss === null || (typeof position.stopLoss === 'number' && Number.isFinite(position.stopLoss) && position.stopLoss > 0))
    && (position.takeProfit === null || (typeof position.takeProfit === 'number' && Number.isFinite(position.takeProfit) && position.takeProfit > 0))
    && typeof position.openedAt === 'string';
};

const isTrade = (value: unknown): value is PaperFuturesTrade => {
  if (!value || typeof value !== 'object') return false;
  const trade = value as PaperFuturesTrade;
  return typeof trade.id === 'string'
    && typeof trade.coinId === 'string'
    && typeof trade.coinName === 'string'
    && typeof trade.symbol === 'string'
    && ['long', 'short'].includes(trade.side)
    && ['open', 'close', 'liquidated', 'stop-loss', 'take-profit'].includes(trade.action)
    && isFiniteNonNegative(trade.quantity)
    && typeof trade.price === 'number'
    && Number.isFinite(trade.price)
    && trade.price > 0
    && isFiniteNonNegative(trade.margin)
    && typeof trade.leverage === 'number'
    && Number.isFinite(trade.leverage)
    && trade.leverage >= 1
    && trade.leverage <= MAX_FUTURES_LEVERAGE
    && isFiniteNonNegative(trade.fee)
    && typeof trade.realizedPnl === 'number'
    && Number.isFinite(trade.realizedPnl)
    && typeof trade.createdAt === 'string';
};

const isPaperFuturesAccount = (value: unknown): value is PaperFuturesAccount => {
  if (!value || typeof value !== 'object') return false;
  const account = value as PaperFuturesAccount;
  return isFiniteNonNegative(account.balance)
    && typeof account.realizedPnl === 'number'
    && Number.isFinite(account.realizedPnl)
    && Array.isArray(account.positions)
    && account.positions.length <= MAX_POSITIONS
    && account.positions.every(isPosition)
    && Array.isArray(account.trades)
    && account.trades.length <= MAX_TRADES
    && account.trades.every(isTrade)
    && typeof account.updatedAt === 'string';
};

const createId = (prefix: string) => {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* Use the fallback below when crypto is unavailable. */ }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const getFuturesUnrealizedPnl = (position: PaperFuturesPosition, markPrice: number) => {
  const difference = position.side === 'long'
    ? markPrice - position.entryPrice
    : position.entryPrice - markPrice;
  return difference * position.quantity;
};

export const getFuturesLiquidationPrice = (position: PaperFuturesPosition) => {
  const maintenanceRate = 0.005;
  return position.side === 'long'
    ? position.entryPrice * (1 - (1 / position.leverage) + maintenanceRate)
    : position.entryPrice * (1 + (1 / position.leverage) - maintenanceRate);
};

const toCloudPayload = (account: PaperFuturesAccount, userId: string) => ({
  user_id: userId,
  balance: account.balance,
  realized_pnl: account.realizedPnl,
  positions: account.positions as unknown as Json,
  trades: account.trades as unknown as Json,
  updated_at: account.updatedAt,
});

const fromCloudRow = (row: {
  balance: number;
  realized_pnl: number;
  positions: Json;
  trades: Json;
  updated_at: string;
}): PaperFuturesAccount | null => {
  const candidate: unknown = {
    balance: Number(row.balance),
    realizedPnl: Number(row.realized_pnl),
    positions: row.positions,
    trades: row.trades,
    updatedAt: row.updated_at,
  };
  return isPaperFuturesAccount(candidate) ? candidate : null;
};

export const usePaperFutures = () => {
  const { user, loading: authLoading } = useAuth();
  const [account, setAccount] = useState<PaperFuturesAccount>(createInitialPaperFuturesAccount);
  const [localReady, setLocalReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<PaperFuturesSyncStatus>('loading');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const accountRef = useRef(account);
  const cloudReady = useRef(false);
  const pendingAccount = useRef<PaperFuturesAccount | null>(null);
  const persistQueue = useRef(Promise.resolve());
  const persistVersion = useRef(0);

  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  useEffect(() => {
    if (authLoading) {
      setLocalReady(false);
      setSyncStatus('loading');
      setSyncError(null);
      return;
    }
    if (user) {
      setLocalReady(false);
      return;
    }
    try {
      const saved = window.localStorage.getItem(futuresStorageKey);
      const parsed: unknown = saved ? JSON.parse(saved) : null;
      const resolved = isPaperFuturesAccount(parsed) ? parsed : createInitialPaperFuturesAccount();
      accountRef.current = resolved;
      setAccount(resolved);
      setLocalReady(true);
      setSyncStatus('ready');
      setSyncError(null);
    } catch {
      const resolved = createInitialPaperFuturesAccount();
      accountRef.current = resolved;
      setAccount(resolved);
      setLocalReady(true);
      setSyncStatus('ready');
      setSyncError(null);
    }
  }, [authLoading, user]);

  useEffect(() => {
    if (authLoading || user || !localReady) return;
    try { window.localStorage.setItem(futuresStorageKey, JSON.stringify(account)); } catch { /* Storage can be unavailable. */ }
  }, [account, authLoading, localReady, user]);

  useEffect(() => {
    let cancelled = false;
    const previousAccount = accountRef.current;
    cloudReady.current = false;
    pendingAccount.current = null;
    const client = supabase;
    if (authLoading || !client || !user) return undefined;

    setSyncStatus('loading');
    setSyncError(null);
    const isMeaningfulAccount = previousAccount.positions.length > 0
      || previousAccount.trades.length > 0
      || previousAccount.balance !== STARTING_FUTURES_BALANCE
      || previousAccount.realizedPnl !== 0;
    pendingAccount.current = syncAttempt > 0 && isMeaningfulAccount ? previousAccount : null;
    const emptyAccount = createInitialPaperFuturesAccount();
    const startingAccount = pendingAccount.current ?? emptyAccount;
    accountRef.current = startingAccount;
    setAccount(startingAccount);
    try { window.localStorage.removeItem(futuresStorageKey); } catch { /* Storage can be unavailable. */ }

    const loadCloudAccount = async () => {
      const { data, error } = await client
        .from('paper_futures_accounts')
        .select('balance, realized_pnl, positions, trades, updated_at')
        .eq('user_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setSyncError('Your simulated account could not be loaded. Nothing will open until it is synced.');
        setSyncStatus('error');
        return;
      }

      const remote = data ? fromCloudRow(data) : null;
      const resolved = pendingAccount.current
        ?? remote
        ?? emptyAccount;
      accountRef.current = resolved;
      setAccount(resolved);
      const { error: writeError } = await client
        .from('paper_futures_accounts')
        .upsert(toCloudPayload(resolved, user.id), { onConflict: 'user_id' });
      if (cancelled) return;
      if (writeError) {
        setSyncError('Your simulated account could not be saved. Check your account connection and retry.');
        setSyncStatus('error');
        return;
      }
      cloudReady.current = true;
      setSyncStatus('ready');
      setSyncError(null);
      pendingAccount.current = null;
    };

    void loadCloudAccount();
    return () => { cancelled = true; };
  }, [authLoading, syncAttempt, user]);

  const commitAccount = useCallback((next: PaperFuturesAccount) => {
    accountRef.current = next;
    setAccount(next);
    if (!supabase || !user) return;
    if (!cloudReady.current) {
      pendingAccount.current = next;
      return;
    }
    const version = ++persistVersion.current;
    setSyncStatus('saving');
    persistQueue.current = persistQueue.current
      .catch(() => undefined)
      .then(async () => {
        const { error } = await supabase!.from('paper_futures_accounts')
          .upsert(toCloudPayload(next, user.id), { onConflict: 'user_id' });
        if (error) {
          if (version === persistVersion.current) {
            setSyncError('Your simulated account could not be saved. Check your account connection and retry.');
            setSyncStatus('error');
          }
          return;
        }
        if (version === persistVersion.current) {
          setSyncError(null);
          setSyncStatus('ready');
        }
      });
  }, [setAccount, user]);

  const retrySync = useCallback(() => {
    if (!user || !supabase) return;
    setSyncAttempt((value) => value + 1);
  }, [user]);

  const openPosition = useCallback((input: OpenFuturesPositionInput): FuturesActionResult => {
    const current = accountRef.current;
    if (user && syncStatus !== 'ready') return { ok: false, message: 'Your simulated account is still syncing. Try again when it is ready.' };
    if (current.positions.some((position) => position.coinId === input.coinId)) {
      return { ok: false, message: 'Close the existing position for this asset first.' };
    }
    if (!Number.isFinite(input.price) || input.price <= 0) return { ok: false, message: 'A live mark price is required.' };
    if (!Number.isFinite(input.margin) || input.margin <= 0) return { ok: false, message: 'Enter a margin greater than zero.' };
    if (!Number.isFinite(input.leverage) || input.leverage < 1 || input.leverage > MAX_FUTURES_LEVERAGE) return { ok: false, message: `Leverage must be between 1x and ${MAX_FUTURES_LEVERAGE}x.` };
    const notional = input.margin * input.leverage;
    const fee = notional * FUTURES_TAKER_FEE;
    if (current.balance < input.margin + fee) return { ok: false, message: 'Your available balance cannot cover that margin and fee.' };

    const position: PaperFuturesPosition = {
      id: createId('position'),
      coinId: input.coinId,
      coinName: input.coinName,
      symbol: input.symbol,
      side: input.side,
      quantity: notional / input.price,
      entryPrice: input.price,
      margin: input.margin,
      leverage: input.leverage,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      openedAt: new Date().toISOString(),
    };
    const trade: PaperFuturesTrade = {
      id: createId('trade'),
      coinId: input.coinId,
      coinName: input.coinName,
      symbol: input.symbol,
      side: input.side,
      action: 'open',
      quantity: position.quantity,
      price: input.price,
      margin: input.margin,
      leverage: input.leverage,
      fee,
      realizedPnl: 0,
      createdAt: position.openedAt,
    };
    commitAccount({
      balance: current.balance - input.margin - fee,
      realizedPnl: current.realizedPnl - fee,
      positions: [...current.positions, position].slice(0, MAX_POSITIONS),
      trades: [trade, ...current.trades].slice(0, MAX_TRADES),
      updatedAt: new Date().toISOString(),
    });
    return { ok: true, message: `${input.side === 'long' ? 'Long' : 'Short'} position opened.`, position, trade };
  }, [commitAccount, syncStatus, user]);

  const closePosition = useCallback((positionId: string, price: number, action: Exclude<PaperFuturesTradeAction, 'open'> = 'close'): FuturesActionResult => {
    const current = accountRef.current;
    if (user && syncStatus !== 'ready') return { ok: false, message: 'Your simulated account is still syncing. Try again when it is ready.' };
    const position = current.positions.find((item) => item.id === positionId);
    if (!position) return { ok: false, message: 'That position is no longer open.' };
    if (!Number.isFinite(price) || price <= 0) return { ok: false, message: 'A live mark price is required to close.' };
    const grossPnl = getFuturesUnrealizedPnl(position, price);
    const pnl = Math.max(-position.margin, grossPnl);
    const fee = position.quantity * price * FUTURES_TAKER_FEE;
    const realizedPnl = pnl - fee;
    const trade: PaperFuturesTrade = {
      id: createId('trade'),
      coinId: position.coinId,
      coinName: position.coinName,
      symbol: position.symbol,
      side: position.side,
      action,
      quantity: position.quantity,
      price,
      margin: position.margin,
      leverage: position.leverage,
      fee,
      realizedPnl,
      createdAt: new Date().toISOString(),
    };
    commitAccount({
      balance: Math.max(0, current.balance + position.margin + realizedPnl),
      realizedPnl: current.realizedPnl + realizedPnl,
      positions: current.positions.filter((item) => item.id !== positionId),
      trades: [trade, ...current.trades].slice(0, MAX_TRADES),
      updatedAt: new Date().toISOString(),
    });
    return { ok: true, message: action === 'liquidated' ? `${position.symbol.toUpperCase()} position liquidated.` : `${position.symbol.toUpperCase()} position closed.`, trade };
  }, [commitAccount, syncStatus, user]);

  const checkPosition = useCallback((positionId: string, markPrice: number): FuturesActionResult | null => {
    const position = accountRef.current.positions.find((item) => item.id === positionId);
    if (!position || !Number.isFinite(markPrice) || markPrice <= 0) return null;
    const liquidationPrice = getFuturesLiquidationPrice(position);
    const liquidationHit = position.side === 'long' ? markPrice <= liquidationPrice : markPrice >= liquidationPrice;
    if (liquidationHit) return closePosition(positionId, markPrice, 'liquidated');
    const stopHit = position.stopLoss != null && (position.side === 'long' ? markPrice <= position.stopLoss : markPrice >= position.stopLoss);
    if (stopHit) return closePosition(positionId, markPrice, 'stop-loss');
    const targetHit = position.takeProfit != null && (position.side === 'long' ? markPrice >= position.takeProfit : markPrice <= position.takeProfit);
    if (targetHit) return closePosition(positionId, markPrice, 'take-profit');
    return null;
  }, [closePosition]);

  return {
    account,
    openPosition,
    closePosition,
    checkPosition,
    syncStatus,
    syncError,
    accountReady: !user ? localReady : syncStatus === 'ready',
    retrySync,
  };
};
