import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, BarChart3, CircleDollarSign, Gauge, LockKeyhole, RadioTower, ShieldAlert, TrendingDown, TrendingUp, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataState } from '../components/DataState';
import { useMarket } from '../context/MarketContext';
import { useToast } from '../context/ToastContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { resolveFuturesMarkPrice, useFuturesMarketPrice } from '../hooks/useFuturesMarketPrice';
import { FUTURES_TAKER_FEE, FUTURES_FUNDING_RATE, getFuturesReservedBalance, getFuturesLiquidationPrice, getFuturesMaintenanceMargin, getFuturesReturnOnEquity, getFuturesUnrealizedPnl, getMissingOpenOrderCoinIds, getOpenOrderMarketChecks, MAX_FUTURES_LEVERAGE, validateFuturesProtection } from '../hooks/usePaperFutures';
import { fetchCoinPrices, fetchMarketData, getApiErrorMessage } from '../services/api';
import { Coin, FuturesSide } from '../types/crypto';
import { formatCurrency, formatDateTime, formatPercent } from '../utils/format';
import '../styles/Futures.css';

const formatAction = (action: string) => {
  if (action === 'stop-loss') return 'Stop loss';
  if (action === 'take-profit') return 'Take profit';
  return action.charAt(0).toUpperCase() + action.slice(1);
};

const stableSymbols = new Set([
  'usdt', 'usdc', 'dai', 'usds', 'usde', 'usdg', 'pyusd', 'fdusd', 'tusd', 'usdd', 'rlusd', 'usd1',
  'usyc',
  'usdf', 'bfusd', 'usdy', 'usdgo', 'gho', 'stable', 'eur', 'eurt', 'u',
]);

const nonPerpetualAssetName = /fund|treasury|swap|money market|government securities|digital liquidity|gold/i;

const FuturesPage: React.FC = () => {
  usePageMeta('Trade', 'Practice cryptocurrency futures with virtual funds, simulated positions, and live market prices.');
  const {
    coins,
    currency,
    loading,
    error,
    refresh,
    paperFutures,
    openFuturesPosition,
    placeFuturesOrder,
    cancelFuturesOrder,
    checkFuturesOrders,
    closeFuturesPosition,
    checkFuturesPosition,
    paperFuturesSyncStatus,
    paperFuturesSyncError,
    retryPaperFuturesSync,
  } = useMarket();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [usdCoins, setUsdCoins] = useState<Coin[]>([]);
  const [usdError, setUsdError] = useState<string | null>(null);
  const [usdRequestKey, setUsdRequestKey] = useState(0);
  useEffect(() => {
    if (currency === 'usd') {
      setUsdCoins([]);
      setUsdError(null);
      return undefined;
    }
    let active = true;
    setUsdError(null);
    void fetchMarketData('usd').then((nextCoins) => {
      if (active) setUsdCoins(nextCoins);
    }).catch((loadError) => {
      if (active) setUsdError(getApiErrorMessage(loadError, 'market'));
    });
    return () => { active = false; };
  }, [currency, usdRequestKey]);
  const futuresCoins = currency === 'usd' ? coins : usdCoins;
  const tradableCoins = useMemo(() => futuresCoins.filter((coin) => (
    !stableSymbols.has(coin.symbol.toLowerCase()) && !nonPerpetualAssetName.test(coin.name)
  )), [futuresCoins]);
  const requestedCoin = searchParams.get('coin');
  const previousSelection = useRef<Coin | null>(null);
  const selectedCoin = useMemo(() => tradableCoins.find((coin) => coin.id === requestedCoin)
    ?? (previousSelection.current?.id === requestedCoin ? previousSelection.current : null)
    ?? tradableCoins[0] ?? null, [requestedCoin, tradableCoins]);
  useEffect(() => { if (selectedCoin) previousSelection.current = selectedCoin; }, [selectedCoin]);
  const assetOptions = selectedCoin && !tradableCoins.some(coin => coin.id === selectedCoin.id) ? [selectedCoin, ...tradableCoins] : tradableCoins;
  const { price: feedMarkPrice, priceCoinId, status: feedStatus, lastUpdated: markUpdatedAt, fundingRate, retry: retryFeed } = useFuturesMarketPrice(selectedCoin);
  const markPrice = resolveFuturesMarkPrice(selectedCoin, priceCoinId, feedMarkPrice);
  const [side, setSide] = useState<FuturesSide>('long');
  const [margin, setMargin] = useState('100');
  const [leverage, setLeverage] = useState('5');
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop-market'>('market');
  const [entryPrice, setEntryPrice] = useState('');
  const [marginMode, setMarginMode] = useState<'isolated' | 'cross'>('isolated');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [reducePercent, setReducePercent] = useState('100');
  const [closePercents, setClosePercents] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const missingOrderCoinIds = useMemo(() => {
    const listedCoins = new Set(futuresCoins.map((coin) => coin.id));
    return [...new Set([
      ...getMissingOpenOrderCoinIds(paperFutures.orders, listedCoins),
      ...paperFutures.positions.filter(position => !listedCoins.has(position.coinId)).map(position => position.coinId),
    ])];
  }, [futuresCoins, paperFutures.orders, paperFutures.positions]);
  const [missingOrderMarks, setMissingOrderMarks] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let active = true;
    if (missingOrderCoinIds.length === 0) {
      setMissingOrderMarks((current) => current.size === 0 ? current : new Map());
      return () => { active = false; };
    }
    const loadMissingMarks = () => {
      void fetchCoinPrices(missingOrderCoinIds, 'usd').then((prices) => {
        if (active) setMissingOrderMarks(prices);
      }).catch(() => {
        if (active) setMissingOrderMarks(new Map());
      });
    };
    loadMissingMarks();
    const interval = window.setInterval(loadMissingMarks, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [missingOrderCoinIds]);
  const marks = useMemo(() => {
    const next = new Map(missingOrderMarks);
    futuresCoins.forEach((coin) => next.set(coin.id, coin.id === selectedCoin?.id ? markPrice : coin.current_price));
    if (selectedCoin && markPrice > 0) next.set(selectedCoin.id, markPrice);
    return next;
  }, [futuresCoins, markPrice, missingOrderMarks, selectedCoin?.id]);
  const openPositions = paperFutures.positions;
  const marginUsed = openPositions.reduce((sum, position) => sum + position.margin, 0);
  const reservedBalance = getFuturesReservedBalance(paperFutures.orders);
  const unrealizedPnl = openPositions.reduce((sum, position) => sum + getFuturesUnrealizedPnl(position, marks.get(position.coinId) ?? position.entryPrice), 0);
  const equity = paperFutures.balance + marginUsed + reservedBalance + unrealizedPnl;
  const selectedPosition = selectedCoin ? openPositions.find((position) => position.coinId === selectedCoin.id) : undefined;
  const displayedMarginMode = selectedPosition?.marginMode ?? marginMode;
  const parsedMargin = Number(margin);
  const parsedLeverage = Number(leverage);
  const effectiveSide = selectedPosition ? (reduceOnly ? selectedPosition.side === 'long' ? 'short' : 'long' : selectedPosition.side) : side;
  const parsedEntry = Number(entryPrice);
  const previewPrice = orderType === 'market' ? markPrice : Number.isFinite(parsedEntry) && parsedEntry > 0 ? parsedEntry : 0;
  const previewNotional = reduceOnly && selectedPosition
    ? selectedPosition.quantity * previewPrice * (Number(reducePercent) / 100)
    : selectedPosition ? selectedPosition.quantity * markPrice
      : Number.isFinite(parsedMargin) && parsedMargin > 0 && Number.isFinite(parsedLeverage) ? parsedMargin * parsedLeverage : 0;
  const previewQuantity = reduceOnly && selectedPosition
    ? selectedPosition.quantity * (Number(reducePercent) / 100)
    : selectedPosition ? selectedPosition.quantity : previewNotional > 0 && previewPrice > 0 ? previewNotional / previewPrice : 0;
  const previewFee = previewNotional * FUTURES_TAKER_FEE;
  const accountSyncBusy = paperFuturesSyncStatus !== 'ready';

  useEffect(() => {
    if (paperFuturesSyncStatus !== 'ready') return;
    openPositions.forEach((position) => {
      const positionMark = marks.get(position.coinId);
      if (!positionMark || !Number.isFinite(positionMark)) return;
      const result = checkFuturesPosition(position.id, positionMark);
      if (result?.ok) showToast(result.message, result.trade?.action === 'liquidated' ? 'error' : 'info');
    });
    getOpenOrderMarketChecks(paperFutures.orders, marks).forEach(({ coinId, markPrice: orderMark }) => {
      checkFuturesOrders(coinId, orderMark).forEach((result) => {
        if (result.ok) showToast(result.message, 'success');
        else showToast(result.message, 'error');
      });
    });
  }, [checkFuturesOrders, checkFuturesPosition, marks, openPositions, paperFutures.orders, paperFuturesSyncStatus, showToast]);

  useEffect(() => {
    if (tradableCoins.length > 0 && (!requestedCoin || selectedCoin?.id !== requestedCoin)) {
      setSearchParams({ coin: tradableCoins[0].id }, { replace: true });
    }
  }, [requestedCoin, selectedCoin, setSearchParams, tradableCoins]);

  useEffect(() => {
    setEntryPrice(''); setStopLoss(''); setTakeProfit(''); setFormError(null);
    setReduceOnly(false); setReducePercent('100');
  }, [selectedCoin?.id]);

  const changeSide = (next: FuturesSide) => {
    setSide(next); setEntryPrice(''); setStopLoss(''); setTakeProfit(''); setFormError(null);
  };
  const formatQuantity = (quantity: number) => quantity.toLocaleString('en-US', { maximumSignificantDigits: 8 });

  const submitOrder = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!selectedCoin || !markPrice) {
      setFormError('The current price is unavailable. Please try placing your trade again shortly.');
      return;
    }
    const parsedStop = stopLoss.trim() ? Number(stopLoss) : null;
    const parsedTarget = takeProfit.trim() ? Number(takeProfit) : null;
    const parsedEntry = entryPrice.trim() ? Number(entryPrice) : null;
    if (!reduceOnly && (!Number.isFinite(parsedMargin) || parsedMargin <= 0)) {
      setFormError('Enter a margin greater than zero.');
      return;
    }
    if (!reduceOnly && (!Number.isFinite(parsedLeverage) || parsedLeverage < 1 || parsedLeverage > MAX_FUTURES_LEVERAGE)) {
      setFormError(`Choose leverage between 1x and ${MAX_FUTURES_LEVERAGE}x.`);
      return;
    }
    if (reduceOnly && !selectedPosition) {
      setFormError('Choose the open position you want to reduce.');
      return;
    }
    if (orderType !== 'market' && (!Number.isFinite(parsedEntry) || parsedEntry == null || parsedEntry <= 0)) {
      setFormError(`Enter a ${orderType === 'limit' ? 'limit' : 'trigger'} price.`);
      return;
    }
    if (!reduceOnly) {
      const protectionError = validateFuturesProtection(side, orderType === 'market' ? markPrice : parsedEntry!, parsedStop, parsedTarget);
      if (protectionError) { setFormError(protectionError); return; }
    }
    const baseInput = {
      coinId: selectedCoin.id,
      coinName: selectedCoin.name,
      symbol: selectedCoin.symbol,
      side: reduceOnly && selectedPosition ? (selectedPosition.side === 'long' ? 'short' : 'long') : side,
      price: markPrice,
      margin: reduceOnly ? 0 : parsedMargin,
      leverage: reduceOnly && selectedPosition ? selectedPosition.leverage : parsedLeverage,
      marginMode: reduceOnly && selectedPosition ? (selectedPosition.marginMode ?? 'isolated') : marginMode,
      stopLoss: reduceOnly ? null : parsedStop,
      takeProfit: reduceOnly ? null : parsedTarget,
    };
    const closeQuantity = selectedPosition && reduceOnly ? selectedPosition.quantity * (Number(reducePercent) / 100) : undefined;
    const result = reduceOnly && selectedPosition && orderType === 'market'
      ? closeFuturesPosition(selectedPosition.id, markPrice, 'close', closeQuantity)
      : orderType === 'market'
        ? openFuturesPosition(baseInput)
      : placeFuturesOrder({
        ...baseInput,
        orderType,
        limitPrice: orderType === 'limit' ? parsedEntry : null,
        triggerPrice: orderType === 'stop-market' ? parsedEntry : null,
        reduceOnly,
        positionId: reduceOnly && selectedPosition ? selectedPosition.id : null,
        quantity: closeQuantity ?? null,
      });
    if (!result.ok) {
      setFormError(result.message);
      showToast(result.message, 'error');
      return;
    }
    setMargin('100');
    setEntryPrice('');
    setStopLoss('');
    setTakeProfit('');
    setReduceOnly(false);
    showToast(result.message);
  };

  const closeSelectedPosition = (positionId: string, price: number) => {
    const selected = openPositions.find((position) => position.id === positionId);
    const fraction = Number(closePercents[positionId] ?? '100') / 100;
    const quantity = selected && fraction < 1 ? selected.quantity * fraction : undefined;
    const result = closeFuturesPosition(positionId, price, 'close', quantity);
    if (result.ok) showToast(result.message, result.trade && result.trade.realizedPnl >= 0 ? 'success' : 'info');
    else showToast(result.message, 'error');
  };

  const cancelSelectedOrder = (orderId: string) => {
    const result = cancelFuturesOrder(orderId);
    showToast(result.message, result.ok ? 'info' : 'error');
  };

  if (!selectedCoin && (loading || (currency !== 'usd' && !usdError && usdCoins.length === 0))) {
    return <main className="app-container page-stack"><div className="table-skeleton futures-loading-skeleton" /></main>;
  }
  if (!selectedCoin) {
    return <main className="app-container page-stack"><DataState title="Futures market unavailable" message={error ?? usdError ?? 'We couldn’t load the latest market data. Please try again.'} onRetry={currency === 'usd' ? refresh : () => setUsdRequestKey((value) => value + 1)} /></main>;
  }

  return (
    <main className="app-container page-stack futures-page">
      <header className="markets-header page-header-card futures-header">
        <div className="markets-title-wrap">
          <span className="markets-icon futures-icon"><BarChart3 size={25} aria-hidden="true" /></span>
          <div>
            <span className="eyebrow">Paper futures</span>
            <h1>Futures simulator</h1>
            <p>Practice long and short trades with live prices and virtual funds.</p>
          </div>
        </div>
        <span className="simulated-badge"><span aria-hidden="true" /> Simulated only</span>
      </header>

      <div className="futures-notice" role="note">
        <LockKeyhole size={16} aria-hidden="true" />
        <p><strong>No exchange orders.</strong> This terminal uses virtual funds. Positions and results stay inside BlockLens.</p>
      </div>

      {paperFuturesSyncStatus === 'loading' && (
        <div className="futures-sync-state" role="status">
          <span className="inline-spinner" aria-hidden="true" />
          <p>Loading your trading account…</p>
        </div>
      )}
      {paperFuturesSyncError && (
        <div className="futures-sync-state error" role="alert">
          <ShieldAlert size={15} aria-hidden="true" />
          <p>{paperFuturesSyncError}</p>
          <button type="button" className="futures-feed-retry" onClick={retryPaperFuturesSync}>{paperFuturesSyncError.includes('changed in another') ? 'Reload account' : 'Try again'}</button>
        </div>
      )}

      <section className="futures-account-bar" aria-label="Simulated account summary">
        <div><span>Available balance</span><strong>{formatCurrency(paperFutures.balance, 'usd')}</strong></div>
        <div><span>Equity</span><strong>{formatCurrency(equity, 'usd')}</strong></div>
        <div><span>Margin in use</span><strong>{formatCurrency(marginUsed + reservedBalance, 'usd')}</strong>{reservedBalance > 0 && <small>{formatCurrency(reservedBalance, 'usd')} reserved for orders</small>}</div>
        <div><span>Unrealized P&amp;L</span><strong className={unrealizedPnl >= 0 ? 'text-up' : 'text-down'}>{formatCurrency(unrealizedPnl, 'usd')}</strong></div>
      </section>

      <section className="futures-market-toolbar">
        <label className="coin-select-control">
          <span>Trade asset</span>
          <select value={selectedCoin.id} onChange={(event) => setSearchParams({ coin: event.target.value })}>
            {assetOptions.map((coin) => <option value={coin.id} key={coin.id}>{coin.name} ({coin.symbol.toUpperCase()})</option>)}
          </select>
        </label>
        <div className="futures-live-price">
          <span><span className={`futures-status-dot ${feedStatus}`} aria-hidden="true" /> {feedStatus === 'live' || feedStatus === 'polling' ? 'Live mark price' : feedStatus === 'fallback' ? 'Market snapshot' : 'Connecting to mark price'}</span>
          <strong>{formatCurrency(markPrice, 'usd')}</strong>
          {markUpdatedAt && <small>Updated {formatDateTime(markUpdatedAt)}</small>}
          {feedStatus !== 'live' && <button type="button" className="futures-feed-retry" onClick={retryFeed}>Retry feed</button>}
        </div>
      </section>

      <section className="futures-grid">
        <form className="form-card futures-order-card" onSubmit={submitOrder}>
          <div className="section-heading compact-heading">
            <div><span className="eyebrow">Order ticket</span><h2>{reduceOnly ? 'Reduce a position' : 'Open a position'}</h2></div>
            <Gauge size={18} aria-hidden="true" />
          </div>
          {selectedPosition && !reduceOnly && <p className="form-help">You have an open {selectedPosition.symbol.toUpperCase()} position. Select Reduce only to close part or all of it.</p>}
          <div className="futures-side-toggle" role="group" aria-label="Position direction">
            <button type="button" aria-pressed={effectiveSide === 'long'} disabled={reduceOnly} className={effectiveSide === 'long' ? 'active long' : ''} onClick={() => changeSide('long')}><TrendingUp size={15} aria-hidden="true" /><span>Long<small>Buy</small></span></button>
            <button type="button" aria-pressed={effectiveSide === 'short'} disabled={reduceOnly} className={effectiveSide === 'short' ? 'active short' : ''} onClick={() => changeSide('short')}><TrendingDown size={15} aria-hidden="true" /><span>Short<small>Sell</small></span></button>
          </div>
          <div className="futures-order-type" role="group" aria-label="Order type">
            {(['market', 'limit', 'stop-market'] as const).map((type) => (
              <button type="button" key={type} aria-pressed={orderType === type} className={orderType === type ? 'active' : ''} onClick={() => { setOrderType(type); setFormError(null); }}>{type === 'stop-market' ? 'Stop market' : type === 'market' ? 'Market' : 'Limit'}</button>
            ))}
          </div>
          <label className="futures-reduce-toggle"><input type="checkbox" checked={reduceOnly} disabled={!selectedPosition} onChange={(event) => { setReduceOnly(event.target.checked); setEntryPrice(''); setFormError(null); }} /><span>Reduce only</span><small>{selectedPosition ? 'Only lowers an existing position' : 'Open a position to use reduce only'}</small></label>
          {reduceOnly && <label>Amount to reduce<select aria-label="Amount to reduce" value={reducePercent} onChange={event => setReducePercent(event.target.value)}>{['25', '50', '75', '100'].map(value => <option key={value} value={value}>{value}%</option>)}</select></label>}
          <div className="futures-order-meta"><span>Available <strong>{formatCurrency(paperFutures.balance, 'usd')}</strong></span><span>Fee <strong>{(FUTURES_TAKER_FEE * 100).toFixed(2)}%</strong></span></div>
          <div className="futures-order-asset"><img src={selectedCoin.image} alt="" /><div><strong>{selectedCoin.name}</strong><span>{selectedCoin.symbol.toUpperCase()} / USD paper futures</span></div><span className="futures-order-price">{formatCurrency(markPrice, 'usd')}</span></div>
          <div className="form-row">
            <label>Margin (USD)<input inputMode="decimal" type="number" min="0" step="any" value={selectedPosition?.margin ?? margin} onChange={(event) => setMargin(event.target.value)} disabled={Boolean(selectedPosition) || reduceOnly} /></label>
            <label>Leverage<select value={selectedPosition?.leverage ?? leverage} onChange={(event) => setLeverage(event.target.value)} disabled={Boolean(selectedPosition) || reduceOnly}>{[1, 2, 3, 5, 10, 15, 20, 25, 50, 75, 100, 125].map((value) => <option value={value} key={value}>{value}x</option>)}</select></label>
          </div>
          <div className="futures-margin-mode">
            <span>Margin mode</span>
            <div role="group" aria-label="Margin mode">
              <button type="button" aria-pressed={displayedMarginMode === 'isolated'} disabled={Boolean(selectedPosition) || reduceOnly} className={displayedMarginMode === 'isolated' ? 'active' : ''} onClick={() => setMarginMode('isolated')}>Isolated</button>
              <button type="button" aria-pressed={displayedMarginMode === 'cross'} disabled={Boolean(selectedPosition) || reduceOnly} className={displayedMarginMode === 'cross' ? 'active' : ''} onClick={() => setMarginMode('cross')}>Cross</button>
            </div>
            <small>{displayedMarginMode === 'cross' ? 'Other available balance can absorb losses.' : 'Losses are limited to this position’s margin. Fees and funding are charged separately.'}</small>
          </div>
          {orderType !== 'market' && (
            <label className="futures-entry-price-label">{orderType === 'limit' ? 'Limit price' : 'Trigger price'}
              <input inputMode="decimal" type="number" min="0" step="any" placeholder={orderType === 'limit' ? (effectiveSide === 'long' ? 'Below mark price' : 'Above mark price') : (effectiveSide === 'long' ? 'Above mark price' : 'Below mark price')} value={entryPrice} onChange={(event) => setEntryPrice(event.target.value)} disabled={Boolean(selectedPosition) && !reduceOnly} />
            </label>
          )}
          <div className="futures-risk-controls">
            <div className="futures-risk-heading"><span>Risk controls</span><small>Optional trigger prices</small></div>
            <div className="form-row">
              <label>Stop loss price<input inputMode="decimal" type="number" min="0" step="any" placeholder={side === 'long' ? 'Below entry price' : 'Above entry price'} value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} disabled={Boolean(selectedPosition) || reduceOnly} /></label>
              <label>Take profit price<input inputMode="decimal" type="number" min="0" step="any" placeholder={side === 'long' ? 'Above entry price' : 'Below entry price'} value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} disabled={Boolean(selectedPosition) || reduceOnly} /></label>
            </div>
          </div>
          <div className="futures-order-preview">
            <div><span>Position value</span><strong>{formatCurrency(previewNotional, 'usd')}</strong></div>
            <div><span>Quantity</span><strong>{previewQuantity > 0 ? formatQuantity(previewQuantity) : '—'} {selectedCoin.symbol.toUpperCase()}</strong></div>
            <div><span>{reduceOnly ? 'Est. closing fee' : 'Est. entry fee'}</span><strong>{formatCurrency(previewFee, 'usd')}</strong></div>
          </div>
          {formError && <p className="futures-form-error" role="alert"><ShieldAlert size={15} aria-hidden="true" /> {formError}</p>}
          <button type="submit" className={`futures-submit-button ${reduceOnly ? 'reduce' : side}`} disabled={(Boolean(selectedPosition) && !reduceOnly) || accountSyncBusy || feedStatus === 'connecting' || markPrice <= 0}>
            {paperFuturesSyncStatus === 'loading' ? 'Loading account…' : paperFuturesSyncStatus === 'error' ? 'Account unavailable' : paperFuturesSyncStatus === 'saving' ? 'Saving order…' : reduceOnly ? (orderType === 'market' ? Number(reducePercent) === 100 ? 'Close position' : 'Reduce position' : `Place reduce-only ${orderType === 'limit' ? 'limit' : 'stop'} order`) : selectedPosition ? 'Position already open' : orderType === 'market' ? `Open ${side}` : `Place ${orderType === 'limit' ? 'limit' : 'stop'} order`}
          </button>
          <p className="form-help">Market orders fill now. Limit and stop orders reserve margin until the live mark price reaches them.</p>
        </form>

        <div className="futures-market-column">
          <section className="futures-market-card">
              <div className="futures-market-card-header">
              <div className="futures-order-asset"><img src={selectedCoin.image} alt="" /><div><strong>{selectedCoin.name}</strong><span>{selectedCoin.symbol.toUpperCase()} / USD</span></div></div>
              <span className="futures-market-feed"><RadioTower size={14} aria-hidden="true" /> {feedStatus === 'live' || feedStatus === 'polling' ? 'Live' : 'Snapshot'}</span>
            </div>
            <div className="futures-large-price"><span>Mark price</span><strong>{formatCurrency(markPrice, 'usd')}</strong><span className={(selectedCoin.price_change_percentage_24h ?? 0) >= 0 ? 'text-up' : 'text-down'}>{formatPercent(selectedCoin.price_change_percentage_24h)} 24h</span></div>
            <div className="futures-market-stats"><div><span>24h high</span><strong>{formatCurrency(selectedCoin.high_24h, 'usd')}</strong></div><div><span>24h low</span><strong>{formatCurrency(selectedCoin.low_24h, 'usd')}</strong></div><div><span>Market funding</span><strong>{fundingRate == null ? '—' : `${(fundingRate * 100).toFixed(4)}%`}</strong></div><div><span>Margin mode</span><strong>Isolated or cross</strong></div></div>
            <div className="futures-market-note"><Activity size={15} aria-hidden="true" /><p>Prices and risk controls are checked while Trade is open. Simulated funding is {(FUTURES_FUNDING_RATE * 100).toFixed(2)}% every 8 hours.</p></div>
          </section>

          {paperFutures.orders.some((order) => order.status === 'open') && (
            <section className="holdings-panel futures-orders-card" aria-labelledby="futures-orders-title">
              <div className="section-heading compact-heading"><div><span className="eyebrow">Waiting orders</span><h2 id="futures-orders-title">Open orders</h2></div><span className="section-count">{paperFutures.orders.filter((order) => order.status === 'open').length}</span></div>
              <div className="futures-pending-list">
                {paperFutures.orders.filter((order) => order.status === 'open').map((order) => (
                  <article className="futures-pending-row" key={order.id}>
                    <div><strong>{order.symbol.toUpperCase()}</strong><span>{order.type === 'stop-market' ? 'Stop market' : 'Limit'} · {order.side}{order.reduceOnly ? ' · reduce only' : ''}</span></div>
                    <div><span>{order.type === 'limit' ? 'Limit' : 'Trigger'}</span><strong>{formatCurrency(order.limitPrice ?? order.triggerPrice ?? 0, 'usd')}</strong></div>
                    <div><span>{order.reduceOnly ? 'Quantity' : 'Reserved'}</span><strong>{order.reduceOnly ? formatQuantity(order.quantity ?? 0) : formatCurrency(order.margin + (order.reservedFee ?? 0), 'usd')}</strong></div>
                    <button type="button" className="futures-cancel-button" onClick={() => cancelSelectedOrder(order.id)} disabled={accountSyncBusy}>Cancel</button>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="holdings-panel futures-positions-card" aria-labelledby="futures-positions-title">
            <div className="section-heading compact-heading"><div><span className="eyebrow">Current positions</span><h2 id="futures-positions-title">Open positions</h2></div><span className="section-count">{openPositions.length} active</span></div>
            {openPositions.length === 0 ? (
              <div className="futures-empty"><CircleDollarSign size={20} aria-hidden="true" /><h3>No open positions</h3><p>Choose a direction and margin to start a simulated trade.</p></div>
            ) : (
              <div className="futures-position-list">
                {openPositions.map((position) => {
                  const positionMark = marks.get(position.coinId);
                  const pnl = positionMark ? getFuturesUnrealizedPnl(position, positionMark) : 0;
                  const roe = positionMark ? getFuturesReturnOnEquity(position, positionMark) : 0;
                  const maintenanceMargin = positionMark ? getFuturesMaintenanceMargin(position, positionMark) : 0;
                  const closePercent = closePercents[position.id] ?? '100';
                  const liquidationPrice = getFuturesLiquidationPrice(position, paperFutures.balance);
                  const positionCoin = futuresCoins.find((coin) => coin.id === position.coinId);
                  return (
                    <article className="futures-position-row" key={position.id}>
                      <div className="futures-position-heading"><div className="futures-order-asset">{positionCoin?.image && <img src={positionCoin.image} alt="" />}<div><strong>{position.coinName}</strong><span>{position.symbol.toUpperCase()} · {position.leverage}x · {position.marginMode ?? 'isolated'}</span></div></div><span className={`signal-badge ${position.side}`}>{position.side}</span></div>
                      <div className="futures-position-values"><div><span>Entry</span><strong>{formatCurrency(position.entryPrice, 'usd')}</strong></div><div><span>Mark</span><strong>{positionMark ? formatCurrency(positionMark, 'usd') : 'Unavailable'}</strong></div><div><span>Stop loss</span><strong className="text-down">{position.stopLoss != null ? formatCurrency(position.stopLoss, 'usd') : '—'}</strong></div><div><span>Take profit</span><strong className="text-up">{position.takeProfit != null ? formatCurrency(position.takeProfit, 'usd') : '—'}</strong></div><div><span>Liquidation</span><strong>{formatCurrency(liquidationPrice, 'usd')}</strong></div><div><span>Maintenance</span><strong>{positionMark ? formatCurrency(maintenanceMargin, 'usd') : '—'}</strong></div><div><span>P&amp;L</span><strong className={pnl >= 0 ? 'text-up' : 'text-down'}>{positionMark ? formatCurrency(pnl, 'usd') : '—'}</strong></div><div><span>ROE</span><strong className={roe >= 0 ? 'text-up' : 'text-down'}>{positionMark ? `${roe >= 0 ? '+' : ''}${roe.toFixed(2)}%` : '—'}</strong></div></div>
                      <div className="futures-position-footer"><span>{formatQuantity(position.quantity)} {position.symbol.toUpperCase()} · {formatCurrency(position.margin, 'usd')} margin</span><div className="futures-position-actions"><label><span>Close</span><select value={closePercent} onChange={(event) => setClosePercents(current => ({ ...current, [position.id]: event.target.value }))} aria-label={`Amount to close ${position.coinName}`}><option value="25">25%</option><option value="50">50%</option><option value="75">75%</option><option value="100">100%</option></select></label><button type="button" className="futures-close-button" onClick={() => positionMark && closeSelectedPosition(position.id, positionMark)} disabled={!positionMark || paperFuturesSyncStatus !== 'ready'}><X size={14} aria-hidden="true" /> {paperFuturesSyncStatus === 'saving' ? 'Saving position…' : paperFuturesSyncStatus === 'loading' ? 'Loading account…' : paperFuturesSyncStatus === 'error' ? 'Account unavailable' : Number(closePercent) === 100 ? 'Close position' : 'Reduce position'}</button></div></div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </section>

      <section className="holdings-panel futures-trades-card" aria-labelledby="futures-trades-title">
        <div className="section-heading compact-heading"><div><span className="eyebrow">Trade history</span><h2 id="futures-trades-title">Recent simulated trades</h2></div><Link className="text-link" to="/history?view=futures">View History <ArrowRight size={14} aria-hidden="true" /></Link></div>
        {paperFutures.trades.length === 0 ? <p className="futures-trades-empty">Your simulated entries and exits will appear here.</p> : (
          <div className="futures-trade-list">
            {paperFutures.trades.slice(0, 10).map((trade) => <article className="futures-trade-row" key={trade.id}><div><strong>{trade.symbol.toUpperCase()}</strong><span>{formatAction(trade.action)} · {trade.side}</span></div><div><span>Price</span><strong>{formatCurrency(trade.price, 'usd')}</strong></div><div><span>Size</span><strong>{formatCurrency(trade.margin * trade.leverage, 'usd')}</strong></div><div><span>Result</span><strong className={trade.realizedPnl >= 0 ? 'text-up' : 'text-down'}>{trade.action === 'open' ? '—' : formatCurrency(trade.realizedPnl, 'usd')}</strong></div><time dateTime={trade.createdAt}>{formatDateTime(trade.createdAt)}</time></article>)}
          </div>
        )}
      </section>
    </main>
  );
};

export default FuturesPage;
