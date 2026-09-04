import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Json, supabase } from '../lib/supabase';
import {
  FuturesMarginMode,
  FuturesSide,
  PaperFuturesAccount,
  PaperFuturesOrder,
  PaperFuturesOrderType,
  PaperFuturesPosition,
  PaperFuturesTrade,
  PaperFuturesTradeAction,
} from '../types/crypto';

export const STARTING_FUTURES_BALANCE = 10_000;
export const FUTURES_TAKER_FEE = 0.0004;
export const FUTURES_MAINTENANCE_RATE = 0.005;
export const FUTURES_FUNDING_RATE = 0.0001;
export const FUTURES_FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;
export const MAX_FUTURES_LEVERAGE = 125;

const MAX_POSITIONS = 20;
const MAX_ORDERS = 200;
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
  marginMode?: FuturesMarginMode;
  stopLoss: number | null;
  takeProfit: number | null;
}

export interface PlaceFuturesOrderInput extends OpenFuturesPositionInput {
  orderType: Exclude<PaperFuturesOrderType, 'market'>;
  limitPrice?: number | null;
  triggerPrice?: number | null;
  reduceOnly?: boolean;
  positionId?: string | null;
  quantity?: number | null;
}

export interface FuturesActionResult {
  ok: boolean;
  message: string;
  position?: PaperFuturesPosition;
  order?: PaperFuturesOrder;
  trade?: PaperFuturesTrade;
}

export type PaperFuturesSyncStatus = 'loading' | 'ready' | 'saving' | 'error';

export const createInitialPaperFuturesAccount = (): PaperFuturesAccount => ({
  balance: STARTING_FUTURES_BALANCE,
  realizedPnl: 0,
  positions: [],
  orders: [],
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
    && (position.marginMode === 'isolated' || position.marginMode === 'cross')
    && (position.stopLoss === null || (typeof position.stopLoss === 'number' && Number.isFinite(position.stopLoss) && position.stopLoss > 0))
    && (position.takeProfit === null || (typeof position.takeProfit === 'number' && Number.isFinite(position.takeProfit) && position.takeProfit > 0))
    && typeof position.openedAt === 'string'
    && typeof position.lastFundingAt === 'string';
};

const isOrder = (value: unknown): value is PaperFuturesOrder => {
  if (!value || typeof value !== 'object') return false;
  const order = value as PaperFuturesOrder;
  return typeof order.id === 'string'
    && typeof order.coinId === 'string'
    && typeof order.coinName === 'string'
    && typeof order.symbol === 'string'
    && ['long', 'short'].includes(order.side)
    && ['market', 'limit', 'stop-market', 'take-profit', 'stop-loss'].includes(order.type)
    && ['open', 'filled', 'cancelled', 'rejected'].includes(order.status)
    && isFiniteNonNegative(order.margin)
    && typeof order.leverage === 'number'
    && Number.isFinite(order.leverage)
    && order.leverage >= 1
    && order.leverage <= MAX_FUTURES_LEVERAGE
    && ['isolated', 'cross'].includes(order.marginMode)
    && (order.limitPrice === null || (typeof order.limitPrice === 'number' && Number.isFinite(order.limitPrice) && order.limitPrice > 0))
    && (order.triggerPrice === null || (typeof order.triggerPrice === 'number' && Number.isFinite(order.triggerPrice) && order.triggerPrice > 0))
    && typeof order.reduceOnly === 'boolean'
    && (order.quantity === null || (typeof order.quantity === 'number' && Number.isFinite(order.quantity) && order.quantity > 0))
    && (order.positionId === null || typeof order.positionId === 'string')
    && (order.stopLoss === null || (typeof order.stopLoss === 'number' && Number.isFinite(order.stopLoss) && order.stopLoss > 0))
    && (order.takeProfit === null || (typeof order.takeProfit === 'number' && Number.isFinite(order.takeProfit) && order.takeProfit > 0))
    && typeof order.createdAt === 'string'
    && (order.filledAt === null || typeof order.filledAt === 'string')
    && (order.cancelledAt === null || typeof order.cancelledAt === 'string');
};

const isTrade = (value: unknown): value is PaperFuturesTrade => {
  if (!value || typeof value !== 'object') return false;
  const trade = value as PaperFuturesTrade;
  return typeof trade.id === 'string'
    && typeof trade.coinId === 'string'
    && typeof trade.coinName === 'string'
    && typeof trade.symbol === 'string'
    && ['long', 'short'].includes(trade.side)
    && ['open', 'close', 'liquidated', 'stop-loss', 'take-profit', 'funding'].includes(trade.action)
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
    && Array.isArray(account.orders)
    && account.orders.length <= MAX_ORDERS
    && account.orders.every(isOrder)
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

const normalizePosition = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return value;
  const position = value as Partial<PaperFuturesPosition>;
  return {
    ...position,
    marginMode: position.marginMode === 'cross' ? 'cross' : 'isolated',
    lastFundingAt: typeof position.lastFundingAt === 'string' ? position.lastFundingAt : position.openedAt,
  };
};

const normalizeOrder = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return value;
  const order = value as Partial<PaperFuturesOrder>;
  return {
    ...order,
    marginMode: order.marginMode === 'cross' ? 'cross' : 'isolated',
    limitPrice: typeof order.limitPrice === 'number' ? order.limitPrice : null,
    triggerPrice: typeof order.triggerPrice === 'number' ? order.triggerPrice : null,
    reduceOnly: Boolean(order.reduceOnly),
    quantity: typeof order.quantity === 'number' ? order.quantity : null,
    positionId: typeof order.positionId === 'string' ? order.positionId : null,
    stopLoss: typeof order.stopLoss === 'number' ? order.stopLoss : null,
    takeProfit: typeof order.takeProfit === 'number' ? order.takeProfit : null,
    filledAt: typeof order.filledAt === 'string' ? order.filledAt : null,
    cancelledAt: typeof order.cancelledAt === 'string' ? order.cancelledAt : null,
  };
};

const normalizeAccount = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return value;
  const account = value as Partial<PaperFuturesAccount>;
  return {
    ...account,
    positions: Array.isArray(account.positions) ? account.positions.map(normalizePosition) : account.positions,
    orders: Array.isArray(account.orders) ? account.orders.map(normalizeOrder) : [],
    trades: Array.isArray(account.trades) ? account.trades : account.trades,
  };
};

export const getFuturesNotional = (position: PaperFuturesPosition, markPrice = position.entryPrice) => (
  Math.max(0, position.quantity * markPrice)
);

export const getFuturesUnrealizedPnl = (position: PaperFuturesPosition, markPrice: number) => {
  const difference = position.side === 'long'
    ? markPrice - position.entryPrice
    : position.entryPrice - markPrice;
  return difference * position.quantity;
};

export const getFuturesReturnOnEquity = (position: PaperFuturesPosition, markPrice: number) => (
  position.margin > 0 ? (getFuturesUnrealizedPnl(position, markPrice) / position.margin) * 100 : 0
);

export const getFuturesMaintenanceMargin = (position: PaperFuturesPosition, markPrice = position.entryPrice) => (
  getFuturesNotional(position, markPrice) * FUTURES_MAINTENANCE_RATE
);

export const getFuturesLiquidationPrice = (position: PaperFuturesPosition, crossBalance = 0) => {
  if ((position.marginMode ?? 'isolated') === 'isolated') {
    const isolated = position.side === 'long'
      ? position.entryPrice * (1 - (1 / position.leverage) + FUTURES_MAINTENANCE_RATE)
      : position.entryPrice * (1 + (1 / position.leverage) - FUTURES_MAINTENANCE_RATE);
    return Math.max(0, isolated);
  }
  const maintenanceMargin = getFuturesMaintenanceMargin(position);
  const liquidationBuffer = position.margin + Math.max(0, crossBalance);
  const priceMove = position.quantity > 0 ? Math.max(0, liquidationBuffer - maintenanceMargin) / position.quantity : position.entryPrice;
  const liquidation = position.side === 'long'
    ? position.entryPrice - priceMove
    : position.entryPrice + priceMove;
  return Math.max(0, liquidation);
};

export const shouldTriggerFuturesOrder = (order: Pick<PaperFuturesOrder, 'type' | 'side' | 'limitPrice' | 'triggerPrice'>, markPrice: number) => {
  const referencePrice = order.type === 'limit' ? order.limitPrice : order.triggerPrice;
  if (referencePrice == null || !Number.isFinite(markPrice)) return false;
  if (order.type === 'limit') return order.side === 'long' ? markPrice <= referencePrice : markPrice >= referencePrice;
  return order.side === 'long' ? markPrice >= referencePrice : markPrice <= referencePrice;
};

const toCloudPayload = (account: PaperFuturesAccount, userId: string) => ({
  user_id: userId,
  balance: account.balance,
  realized_pnl: account.realizedPnl,
  positions: account.positions as unknown as Json,
  orders: account.orders as unknown as Json,
  trades: account.trades as unknown as Json,
  updated_at: account.updatedAt,
});

const toLegacyCloudPayload = (account: PaperFuturesAccount, userId: string) => ({
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
  orders?: Json;
  trades: Json;
  updated_at: string;
}): PaperFuturesAccount | null => {
  const candidate = normalizeAccount({
    balance: Number(row.balance),
    realizedPnl: Number(row.realized_pnl),
    positions: row.positions,
    orders: row.orders ?? [],
    trades: row.trades,
    updatedAt: row.updated_at,
  });
  return isPaperFuturesAccount(candidate) ? candidate : null;
};

const commonInputError = (input: OpenFuturesPositionInput, current: PaperFuturesAccount) => {
  if (current.positions.length >= MAX_POSITIONS) return 'Close a position before adding another.';
  if (current.positions.some((position) => position.coinId === input.coinId)) return 'Close the existing position for this asset first.';
  if (!Number.isFinite(input.price) || input.price <= 0) return 'A live mark price is required.';
  if (!Number.isFinite(input.margin) || input.margin <= 0) return 'Enter a margin greater than zero.';
  if (!Number.isFinite(input.leverage) || input.leverage < 1 || input.leverage > MAX_FUTURES_LEVERAGE) return `Leverage must be between 1x and ${MAX_FUTURES_LEVERAGE}x.`;
  return null;
};

const buildPosition = (input: OpenFuturesPositionInput, price: number, orderId?: string): PaperFuturesPosition => {
  const now = new Date().toISOString();
  return {
    id: createId('position'),
    coinId: input.coinId,
    coinName: input.coinName,
    symbol: input.symbol,
    side: input.side,
    quantity: (input.margin * input.leverage) / price,
    entryPrice: price,
    margin: input.margin,
    leverage: input.leverage,
    marginMode: input.marginMode ?? 'isolated',
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    openedAt: now,
    lastFundingAt: now,
    ...(orderId ? { orderId } : {}),
  } as PaperFuturesPosition;
};

const actionLabel = (action: PaperFuturesTradeAction) => {
  if (action === 'liquidated') return 'liquidated';
  if (action === 'stop-loss') return 'stopped out';
  if (action === 'take-profit') return 'closed at target';
  if (action === 'funding') return 'funding applied';
  return 'closed';
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

  useEffect(() => { accountRef.current = account; }, [account]);

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
      const resolvedCandidate = normalizeAccount(parsed);
      const resolved = isPaperFuturesAccount(resolvedCandidate) ? resolvedCandidate : createInitialPaperFuturesAccount();
      accountRef.current = resolved;
      setAccount(resolved);
    } catch {
      const resolved = createInitialPaperFuturesAccount();
      accountRef.current = resolved;
      setAccount(resolved);
    }
    setLocalReady(true);
    setSyncStatus('ready');
    setSyncError(null);
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
      || previousAccount.orders.length > 0
      || previousAccount.trades.length > 0
      || previousAccount.balance !== STARTING_FUTURES_BALANCE
      || previousAccount.realizedPnl !== 0;
    pendingAccount.current = syncAttempt > 0 && isMeaningfulAccount ? previousAccount : null;
    const emptyAccount = createInitialPaperFuturesAccount();
    const startingAccount = pendingAccount.current ?? emptyAccount;
    accountRef.current = startingAccount;
    setAccount(startingAccount);
    try { window.localStorage.removeItem(futuresStorageKey); } catch { /* Signed-in users never use local persistence. */ }

    const loadCloudAccount = async () => {
      let orderLedgerAvailable = true;
      let firstResult = await client
        .from('paper_futures_accounts')
        .select('balance, realized_pnl, positions, orders, trades, updated_at')
        .eq('user_id', user.id)
        .maybeSingle();
      let data: { balance: number; realized_pnl: number; positions: Json; orders?: Json; trades: Json; updated_at: string } | null = firstResult.data;
      let error = firstResult.error;
      if (cancelled) return;
      if (error) {
        // Projects that ran the original history migration do not have the
        // optional order-ledger column yet. Keep existing accounts usable while
        // the follow-up migration is applied.
        orderLedgerAvailable = false;
        const legacyResult = await client
          .from('paper_futures_accounts')
          .select('balance, realized_pnl, positions, trades, updated_at')
          .eq('user_id', user.id)
          .maybeSingle();
        data = legacyResult.data ? { ...legacyResult.data, orders: undefined } : null;
        error = legacyResult.error;
        if (error) {
          setSyncError('Your simulated account could not be loaded. Nothing will open until it is synced.');
          setSyncStatus('error');
          return;
        }
      }
      const remote = data ? fromCloudRow(data) : null;
      const resolved = pendingAccount.current ?? remote ?? emptyAccount;
      accountRef.current = resolved;
      setAccount(resolved);
      let { error: writeError } = await client
        .from('paper_futures_accounts')
        .upsert(toCloudPayload(resolved, user.id), { onConflict: 'user_id' });
      if (writeError && !orderLedgerAvailable) {
        const legacyWrite = await client
          .from('paper_futures_accounts')
          .upsert(toLegacyCloudPayload(resolved, user.id), { onConflict: 'user_id' });
        writeError = legacyWrite.error;
      }
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
        let { error } = await supabase!.from('paper_futures_accounts')
          .upsert(toCloudPayload(next, user.id), { onConflict: 'user_id' });
        if (error) {
          const legacyWrite = await supabase!.from('paper_futures_accounts')
            .upsert(toLegacyCloudPayload(next, user.id), { onConflict: 'user_id' });
          error = legacyWrite.error;
        }
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
  }, [user]);

  const retrySync = useCallback(() => {
    if (!user || !supabase) return;
    setSyncAttempt((value) => value + 1);
  }, [user]);

  const openPosition = useCallback((input: OpenFuturesPositionInput, orderId?: string): FuturesActionResult => {
    const current = accountRef.current;
    if (user && syncStatus !== 'ready') return { ok: false, message: 'Your simulated account is still syncing. Try again when it is ready.' };
    const inputError = commonInputError(input, current);
    if (inputError) return { ok: false, message: inputError };
    const notional = input.margin * input.leverage;
    const fee = notional * FUTURES_TAKER_FEE;
    if (current.balance < input.margin + fee) return { ok: false, message: 'Your available balance cannot cover that margin and fee.' };
    const position = buildPosition(input, input.price, orderId);
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
      ...(orderId ? { orderId } : {}),
    };
    commitAccount({
      balance: current.balance - input.margin - fee,
      realizedPnl: current.realizedPnl - fee,
      positions: [...current.positions, position].slice(0, MAX_POSITIONS),
      orders: current.orders,
      trades: [trade, ...current.trades].slice(0, MAX_TRADES),
      updatedAt: new Date().toISOString(),
    });
    return { ok: true, message: `${input.side === 'long' ? 'Long' : 'Short'} position opened.`, position, trade };
  }, [commitAccount, syncStatus, user]);

  const closePosition = useCallback((positionId: string, price: number, action: Exclude<PaperFuturesTradeAction, 'open' | 'funding'> = 'close', requestedQuantity?: number, orderId?: string): FuturesActionResult => {
    const current = accountRef.current;
    if (user && syncStatus !== 'ready') return { ok: false, message: 'Your simulated account is still syncing. Try again when it is ready.' };
    const position = current.positions.find((item) => item.id === positionId);
    if (!position) return { ok: false, message: 'That position is no longer open.' };
    if (!Number.isFinite(price) || price <= 0) return { ok: false, message: 'A live mark price is required to close.' };
    const quantity = requestedQuantity == null ? position.quantity : requestedQuantity;
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > position.quantity + Number.EPSILON) return { ok: false, message: 'Enter a closing quantity within the open position.' };
    const fraction = Math.min(1, quantity / position.quantity);
    const releasedMargin = position.margin * fraction;
    const grossPnl = getFuturesUnrealizedPnl(position, price) * fraction;
    const pnl = Math.max(-releasedMargin, grossPnl);
    const fee = quantity * price * FUTURES_TAKER_FEE;
    const realizedPnl = pnl - fee;
    const trade: PaperFuturesTrade = {
      id: createId('trade'),
      coinId: position.coinId,
      coinName: position.coinName,
      symbol: position.symbol,
      side: position.side,
      action,
      quantity,
      price,
      margin: releasedMargin,
      leverage: position.leverage,
      fee,
      realizedPnl,
      createdAt: new Date().toISOString(),
      ...(orderId ? { orderId } : {}),
    };
    const remainingQuantity = position.quantity - quantity;
    const remainingPosition = remainingQuantity > Math.max(position.quantity * 0.000001, 1e-12)
      ? { ...position, quantity: remainingQuantity, margin: Math.max(0, position.margin - releasedMargin) }
      : null;
    commitAccount({
      balance: Math.max(0, current.balance + releasedMargin + realizedPnl),
      realizedPnl: current.realizedPnl + realizedPnl,
      positions: current.positions.flatMap((item) => item.id !== positionId ? [item] : (remainingPosition ? [remainingPosition] : [])),
      orders: current.orders,
      trades: [trade, ...current.trades].slice(0, MAX_TRADES),
      updatedAt: new Date().toISOString(),
    });
    const isFullClose = !remainingPosition;
    return {
      ok: true,
      message: action === 'liquidated'
        ? `${position.symbol.toUpperCase()} position liquidated.`
        : `${position.symbol.toUpperCase()} ${isFullClose ? 'position closed' : 'position reduced'} (${actionLabel(action)}).`,
      trade,
      position: remainingPosition ?? undefined,
    };
  }, [commitAccount, syncStatus, user]);

  const placeOrder = useCallback((input: PlaceFuturesOrderInput): FuturesActionResult => {
    const current = accountRef.current;
    if (user && syncStatus !== 'ready') return { ok: false, message: 'Your simulated account is still syncing. Try again when it is ready.' };
    if (input.reduceOnly) {
      const position = input.positionId ? current.positions.find((item) => item.id === input.positionId) : undefined;
      if (!position) return { ok: false, message: 'Choose an open position for a reduce-only order.' };
      const quantity = input.quantity ?? position.quantity;
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > position.quantity) return { ok: false, message: 'The reduce-only quantity is not valid.' };
    } else {
      const inputError = commonInputError(input, current);
      if (inputError) return { ok: false, message: inputError };
      if (current.balance < input.margin) return { ok: false, message: 'Your available balance cannot cover that margin.' };
    }
    if (input.orderType === 'limit' && input.limitPrice == null) return { ok: false, message: 'Enter a limit price.' };
    if (input.orderType !== 'limit' && input.triggerPrice == null) return { ok: false, message: 'Enter a trigger price.' };
    const referencePrice = input.limitPrice ?? input.triggerPrice ?? input.price;
    if (!Number.isFinite(referencePrice) || referencePrice <= 0) return { ok: false, message: 'Enter a valid order price.' };
    const isLongEntry = input.side === 'long';
    if (!input.reduceOnly && input.orderType === 'limit' && (isLongEntry ? referencePrice >= input.price : referencePrice <= input.price)) return { ok: false, message: `A ${isLongEntry ? 'long' : 'short'} limit entry must rest beyond the current mark price.` };
    if (!input.reduceOnly && input.orderType !== 'limit' && (isLongEntry ? referencePrice <= input.price : referencePrice >= input.price)) return { ok: false, message: `A ${isLongEntry ? 'long' : 'short'} stop entry must trigger beyond the current mark price.` };
    const now = new Date().toISOString();
    const order: PaperFuturesOrder = {
      id: createId('order'),
      coinId: input.coinId,
      coinName: input.coinName,
      symbol: input.symbol,
      side: input.side,
      type: input.orderType,
      status: 'open',
      margin: input.reduceOnly ? 0 : input.margin,
      leverage: input.leverage,
      marginMode: input.marginMode ?? 'isolated',
      limitPrice: input.limitPrice ?? null,
      triggerPrice: input.triggerPrice ?? null,
      reduceOnly: Boolean(input.reduceOnly),
      quantity: input.reduceOnly ? (input.quantity ?? null) : null,
      positionId: input.positionId ?? null,
      stopLoss: input.stopLoss ?? null,
      takeProfit: input.takeProfit ?? null,
      createdAt: now,
      filledAt: null,
      cancelledAt: null,
    };
    commitAccount({
      balance: input.reduceOnly ? current.balance : current.balance - input.margin,
      realizedPnl: current.realizedPnl,
      positions: current.positions,
      orders: [order, ...current.orders].slice(0, MAX_ORDERS),
      trades: current.trades,
      updatedAt: now,
    });
    return { ok: true, message: `${input.orderType === 'limit' ? 'Limit' : 'Stop'} order placed.`, order };
  }, [commitAccount, syncStatus, user]);

  const checkOrders = useCallback((coinId: string, markPrice: number): FuturesActionResult[] => {
    if (!Number.isFinite(markPrice) || markPrice <= 0) return [];
    const openOrders = accountRef.current.orders.filter((order) => order.status === 'open' && order.coinId === coinId);
    const results: FuturesActionResult[] = [];
    openOrders.forEach((order) => {
      if (!shouldTriggerFuturesOrder(order, markPrice)) return;
      if (order.reduceOnly && order.positionId) {
        const action: Exclude<PaperFuturesTradeAction, 'open' | 'funding'> = order.type === 'take-profit' ? 'take-profit' : order.type === 'stop-loss' ? 'stop-loss' : 'close';
        const result = closePosition(order.positionId, markPrice, action, order.quantity ?? undefined, order.id);
        if (!result.ok) return;
        const current = accountRef.current;
        const filled = { ...order, status: 'filled' as const, filledAt: new Date().toISOString() };
        commitAccount({ ...current, orders: current.orders.map((item) => item.id === order.id ? filled : item), updatedAt: new Date().toISOString() });
        results.push({ ...result, order: filled });
        return;
      }
      const current = accountRef.current;
      if (current.positions.length >= MAX_POSITIONS) {
        const rejected = { ...order, status: 'rejected' as const, cancelledAt: new Date().toISOString() };
        commitAccount({ ...current, balance: current.balance + order.margin, orders: current.orders.map((item) => item.id === order.id ? rejected : item), updatedAt: new Date().toISOString() });
        results.push({ ok: false, message: 'The position limit has been reached. Close a position before this order fills.', order: rejected });
        return;
      }
      if (current.positions.some((position) => position.coinId === order.coinId)) {
        const cancelled = { ...order, status: 'cancelled' as const, cancelledAt: new Date().toISOString() };
        commitAccount({ ...current, balance: current.balance + order.margin, orders: current.orders.map((item) => item.id === order.id ? cancelled : item), updatedAt: new Date().toISOString() });
        return;
      }
      const fee = order.margin * order.leverage * FUTURES_TAKER_FEE;
      if (current.balance < fee) {
        const rejected = { ...order, status: 'rejected' as const, cancelledAt: new Date().toISOString() };
        commitAccount({ ...current, balance: current.balance + order.margin, orders: current.orders.map((item) => item.id === order.id ? rejected : item), updatedAt: new Date().toISOString() });
        results.push({ ok: false, message: `${order.symbol.toUpperCase()} order was rejected because the entry fee is unavailable.`, order: rejected });
        return;
      }
      const positionInput: OpenFuturesPositionInput = {
        coinId: order.coinId,
        coinName: order.coinName,
        symbol: order.symbol,
        side: order.side,
        price: markPrice,
        margin: order.margin,
        leverage: order.leverage,
        marginMode: order.marginMode,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
      };
      const position = buildPosition(positionInput, markPrice, order.id);
      const trade: PaperFuturesTrade = {
        id: createId('trade'),
        coinId: order.coinId,
        coinName: order.coinName,
        symbol: order.symbol,
        side: order.side,
        action: 'open',
        quantity: position.quantity,
        price: markPrice,
        margin: order.margin,
        leverage: order.leverage,
        fee,
        realizedPnl: 0,
        createdAt: new Date().toISOString(),
        orderId: order.id,
      };
      const filled = { ...order, status: 'filled' as const, quantity: position.quantity, filledAt: new Date().toISOString() };
      commitAccount({
        balance: current.balance - fee,
        realizedPnl: current.realizedPnl - fee,
        positions: [...current.positions, position].slice(0, MAX_POSITIONS),
        orders: current.orders.map((item) => item.id === order.id ? filled : item),
        trades: [trade, ...current.trades].slice(0, MAX_TRADES),
        updatedAt: new Date().toISOString(),
      });
      results.push({ ok: true, message: `${order.symbol.toUpperCase()} ${order.side} order filled.`, position, order: filled, trade });
    });
    return results;
  }, [closePosition, commitAccount]);

  const cancelOrder = useCallback((orderId: string): FuturesActionResult => {
    const current = accountRef.current;
    const order = current.orders.find((item) => item.id === orderId);
    if (!order || order.status !== 'open') return { ok: false, message: 'That order is no longer open.' };
    const cancelled: PaperFuturesOrder = { ...order, status: 'cancelled', cancelledAt: new Date().toISOString() };
    commitAccount({ ...current, balance: current.balance + order.margin, orders: current.orders.map((item) => item.id === orderId ? cancelled : item), updatedAt: new Date().toISOString() });
    return { ok: true, message: `${order.symbol.toUpperCase()} order cancelled.`, order: cancelled };
  }, [commitAccount]);

  const checkPosition = useCallback((positionId: string, markPrice: number): FuturesActionResult | null => {
    let position = accountRef.current.positions.find((item) => item.id === positionId);
    if (!position || !Number.isFinite(markPrice) || markPrice <= 0) return null;
    const elapsed = Date.now() - Date.parse(position.lastFundingAt || position.openedAt);
    const intervals = Number.isFinite(elapsed) ? Math.floor(elapsed / FUTURES_FUNDING_INTERVAL_MS) : 0;
    if (intervals > 0) {
      const funding = getFuturesNotional(position, markPrice) * FUTURES_FUNDING_RATE * intervals;
      const fundingPnl = position.side === 'long' ? -funding : funding;
      const fundingTrade: PaperFuturesTrade = {
        id: createId('trade'),
        coinId: position.coinId,
        coinName: position.coinName,
        symbol: position.symbol,
        side: position.side,
        action: 'funding',
        quantity: position.quantity,
        price: markPrice,
        margin: 0,
        leverage: position.leverage,
        fee: 0,
        realizedPnl: fundingPnl,
        createdAt: new Date().toISOString(),
        fundingRate: FUTURES_FUNDING_RATE * intervals,
      };
      const lastFundingAt = new Date(Date.parse(position.lastFundingAt || position.openedAt) + intervals * FUTURES_FUNDING_INTERVAL_MS).toISOString();
      const fundedPosition = { ...position, lastFundingAt };
      const current = accountRef.current;
      commitAccount({
        ...current,
        balance: Math.max(0, current.balance + fundingPnl),
        realizedPnl: current.realizedPnl + fundingPnl,
        positions: current.positions.map((item) => item.id === positionId ? fundedPosition : item),
        trades: [fundingTrade, ...current.trades].slice(0, MAX_TRADES),
        updatedAt: new Date().toISOString(),
      });
      position = fundedPosition;
    }
    const liquidationPrice = getFuturesLiquidationPrice(position, accountRef.current.balance);
    const liquidationHit = position.side === 'long' ? markPrice <= liquidationPrice : markPrice >= liquidationPrice;
    if (liquidationHit) return closePosition(positionId, markPrice, 'liquidated');
    const stopHit = position.stopLoss != null && (position.side === 'long' ? markPrice <= position.stopLoss : markPrice >= position.stopLoss);
    if (stopHit) return closePosition(positionId, markPrice, 'stop-loss');
    const targetHit = position.takeProfit != null && (position.side === 'long' ? markPrice >= position.takeProfit : markPrice <= position.takeProfit);
    if (targetHit) return closePosition(positionId, markPrice, 'take-profit');
    return null;
  }, [closePosition, commitAccount]);

  return {
    account,
    openPosition,
    closePosition,
    placeOrder,
    cancelOrder,
    checkOrders,
    checkPosition,
    syncStatus,
    syncError,
    accountReady: !user ? localReady : syncStatus === 'ready',
    retrySync,
  };
};
