import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, BarChart3, CircleDollarSign, Gauge, LockKeyhole, RadioTower, ShieldAlert, TrendingDown, TrendingUp, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataState } from '../components/DataState';
import { useMarket } from '../context/MarketContext';
import { useToast } from '../context/ToastContext';
import { useFuturesMarketPrice } from '../hooks/useFuturesMarketPrice';
import { FUTURES_TAKER_FEE, getFuturesLiquidationPrice, getFuturesUnrealizedPnl, MAX_FUTURES_LEVERAGE } from '../hooks/usePaperFutures';
import { fetchMarketData } from '../services/api';
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
  const { coins, currency, loading, error, refresh, paperFutures, openFuturesPosition, closeFuturesPosition, checkFuturesPosition } = useMarket();
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
      if (active) setUsdError(loadError instanceof Error ? loadError.message : 'USD futures prices are unavailable.');
    });
    return () => { active = false; };
  }, [currency, usdRequestKey]);
  const futuresCoins = currency === 'usd' ? coins : usdCoins;
  const tradableCoins = useMemo(() => futuresCoins.filter((coin) => (
    !stableSymbols.has(coin.symbol.toLowerCase()) && !nonPerpetualAssetName.test(coin.name)
  )), [futuresCoins]);
  const requestedCoin = searchParams.get('coin');
  const selectedCoin = useMemo(() => tradableCoins.find((coin) => coin.id === requestedCoin) ?? tradableCoins[0] ?? null, [requestedCoin, tradableCoins]);
  const { price: markPrice, status: feedStatus, lastUpdated: markUpdatedAt, retry: retryFeed } = useFuturesMarketPrice(selectedCoin);
  const [side, setSide] = useState<FuturesSide>('long');
  const [margin, setMargin] = useState('100');
  const [leverage, setLeverage] = useState('5');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const marks = useMemo(() => new Map(futuresCoins.map((coin) => [coin.id, coin.id === selectedCoin?.id ? markPrice : coin.current_price])), [futuresCoins, markPrice, selectedCoin?.id]);
  const openPositions = paperFutures.positions;
  const marginUsed = openPositions.reduce((sum, position) => sum + position.margin, 0);
  const unrealizedPnl = openPositions.reduce((sum, position) => sum + getFuturesUnrealizedPnl(position, marks.get(position.coinId) ?? position.entryPrice), 0);
  const equity = paperFutures.balance + marginUsed + unrealizedPnl;
  const selectedPosition = selectedCoin ? openPositions.find((position) => position.coinId === selectedCoin.id) : undefined;
  const parsedMargin = Number(margin);
  const parsedLeverage = Number(leverage);
  const previewNotional = Number.isFinite(parsedMargin) && parsedMargin > 0 && Number.isFinite(parsedLeverage) ? parsedMargin * parsedLeverage : 0;
  const previewQuantity = previewNotional > 0 && markPrice > 0 ? previewNotional / markPrice : 0;
  const previewFee = previewNotional * FUTURES_TAKER_FEE;

  useEffect(() => {
    openPositions.forEach((position) => {
      const positionMark = marks.get(position.coinId) ?? position.entryPrice;
      const result = checkFuturesPosition(position.id, positionMark);
      if (result?.ok) showToast(result.message, result.trade?.action === 'liquidated' ? 'error' : 'info');
    });
  }, [checkFuturesPosition, marks, openPositions, showToast]);

  useEffect(() => {
    if (tradableCoins.length > 0 && (!requestedCoin || !selectedCoin)) {
      setSearchParams({ coin: tradableCoins[0].id }, { replace: true });
    }
  }, [requestedCoin, selectedCoin, setSearchParams, tradableCoins]);

  const submitOrder = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!selectedCoin || !markPrice) {
      setFormError('A live mark price is required before opening a position.');
      return;
    }
    const parsedStop = stopLoss.trim() ? Number(stopLoss) : null;
    const parsedTarget = takeProfit.trim() ? Number(takeProfit) : null;
    if (!Number.isFinite(parsedMargin) || parsedMargin <= 0) {
      setFormError('Enter a margin greater than zero.');
      return;
    }
    if (!Number.isFinite(parsedLeverage) || parsedLeverage < 1 || parsedLeverage > MAX_FUTURES_LEVERAGE) {
      setFormError(`Choose leverage between 1x and ${MAX_FUTURES_LEVERAGE}x.`);
      return;
    }
    if (parsedStop != null && (!Number.isFinite(parsedStop) || parsedStop <= 0 || (side === 'long' ? parsedStop >= markPrice : parsedStop <= markPrice))) {
      setFormError(`The stop loss must be ${side === 'long' ? 'below' : 'above'} the current mark price.`);
      return;
    }
    if (parsedTarget != null && (!Number.isFinite(parsedTarget) || parsedTarget <= 0 || (side === 'long' ? parsedTarget <= markPrice : parsedTarget >= markPrice))) {
      setFormError(`The take profit must be ${side === 'long' ? 'above' : 'below'} the current mark price.`);
      return;
    }
    const result = openFuturesPosition({
      coinId: selectedCoin.id,
      coinName: selectedCoin.name,
      symbol: selectedCoin.symbol,
      side,
      price: markPrice,
      margin: parsedMargin,
      leverage: parsedLeverage,
      stopLoss: parsedStop,
      takeProfit: parsedTarget,
    });
    if (!result.ok) {
      setFormError(result.message);
      showToast(result.message, 'error');
      return;
    }
    setMargin('100');
    setStopLoss('');
    setTakeProfit('');
    showToast(`${selectedCoin.symbol.toUpperCase()} ${side} position opened.`);
  };

  const closeSelectedPosition = (positionId: string, price: number) => {
    const result = closeFuturesPosition(positionId, price);
    if (result.ok) showToast(result.message, result.trade && result.trade.realizedPnl >= 0 ? 'success' : 'info');
    else showToast(result.message, 'error');
  };

  if (!selectedCoin && (loading || (currency !== 'usd' && !usdError && usdCoins.length === 0))) {
    return <main className="app-container page-stack"><div className="table-skeleton futures-loading-skeleton" /></main>;
  }
  if (!selectedCoin) {
    return <main className="app-container page-stack"><DataState title="Futures market unavailable" message={error ?? usdError ?? 'Load a market snapshot before opening a simulated position.'} onRetry={currency === 'usd' ? refresh : () => setUsdRequestKey((value) => value + 1)} /></main>;
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

      <section className="futures-account-bar" aria-label="Simulated account summary">
        <div><span>Available balance</span><strong>{formatCurrency(paperFutures.balance, 'usd')}</strong></div>
        <div><span>Equity</span><strong>{formatCurrency(equity, 'usd')}</strong></div>
        <div><span>Margin in use</span><strong>{formatCurrency(marginUsed, 'usd')}</strong></div>
        <div><span>Unrealized P&amp;L</span><strong className={unrealizedPnl >= 0 ? 'text-up' : 'text-down'}>{formatCurrency(unrealizedPnl, 'usd')}</strong></div>
      </section>

      <section className="futures-market-toolbar">
        <label className="coin-select-control">
          <span>Trade asset</span>
          <select value={selectedCoin.id} onChange={(event) => setSearchParams({ coin: event.target.value })}>
            {tradableCoins.map((coin) => <option value={coin.id} key={coin.id}>{coin.name} ({coin.symbol.toUpperCase()})</option>)}
          </select>
        </label>
        <div className="futures-live-price">
          <span><span className={`futures-status-dot ${feedStatus}`} aria-hidden="true" /> {feedStatus === 'live' ? 'Live mark price' : feedStatus === 'fallback' ? 'Market snapshot' : 'Connecting to mark price'}</span>
          <strong>{formatCurrency(markPrice, 'usd')}</strong>
          {markUpdatedAt && <small>Updated {formatDateTime(markUpdatedAt)}</small>}
          {feedStatus !== 'live' && <button type="button" className="futures-feed-retry" onClick={retryFeed}>{feedStatus === 'connecting' || feedStatus === 'reconnecting' ? 'Retrying feed' : 'Retry feed'}</button>}
        </div>
      </section>

      <section className="futures-grid">
        <form className="form-card futures-order-card" onSubmit={submitOrder}>
          <div className="section-heading compact-heading">
            <div><span className="eyebrow">Market order</span><h2>Open a position</h2></div>
            <Gauge size={18} aria-hidden="true" />
          </div>
          <div className="futures-side-toggle" role="group" aria-label="Position direction">
            <button type="button" className={side === 'long' ? 'active long' : ''} onClick={() => setSide('long')}><TrendingUp size={15} aria-hidden="true" /><span>Long<small>Buy</small></span></button>
            <button type="button" className={side === 'short' ? 'active short' : ''} onClick={() => setSide('short')}><TrendingDown size={15} aria-hidden="true" /><span>Short<small>Sell</small></span></button>
          </div>
          <div className="futures-order-meta"><span>Available <strong>{formatCurrency(paperFutures.balance, 'usd')}</strong></span><span>Fee <strong>{(FUTURES_TAKER_FEE * 100).toFixed(2)}%</strong></span></div>
          <div className="futures-order-asset"><img src={selectedCoin.image} alt="" /><div><strong>{selectedCoin.name}</strong><span>{selectedCoin.symbol.toUpperCase()} / USD perpetual</span></div><span className="futures-order-price">{formatCurrency(markPrice, 'usd')}</span></div>
          <div className="form-row">
            <label>Margin (USD)<input inputMode="decimal" type="number" min="1" step="any" value={margin} onChange={(event) => setMargin(event.target.value)} disabled={Boolean(selectedPosition)} /></label>
            <label>Leverage<select value={leverage} onChange={(event) => setLeverage(event.target.value)} disabled={Boolean(selectedPosition)}>{[1, 2, 3, 5, 10, 15, 20, 25].map((value) => <option value={value} key={value}>{value}x</option>)}</select></label>
          </div>
          <div className="futures-risk-controls">
            <div className="futures-risk-heading"><span>Risk controls</span><small>Optional trigger prices</small></div>
            <div className="form-row">
              <label>Stop loss price<input inputMode="decimal" type="number" min="0" step="any" placeholder={side === 'long' ? 'Below mark price' : 'Above mark price'} value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} disabled={Boolean(selectedPosition)} /></label>
              <label>Take profit price<input inputMode="decimal" type="number" min="0" step="any" placeholder={side === 'long' ? 'Above mark price' : 'Below mark price'} value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} disabled={Boolean(selectedPosition)} /></label>
            </div>
          </div>
          <div className="futures-order-preview">
            <div><span>Position value</span><strong>{formatCurrency(previewNotional, 'usd')}</strong></div>
            <div><span>Quantity</span><strong>{previewQuantity > 0 ? previewQuantity.toPrecision(6) : '—'} {selectedCoin.symbol.toUpperCase()}</strong></div>
            <div><span>Est. entry fee</span><strong>{formatCurrency(previewFee, 'usd')}</strong></div>
          </div>
          {formError && <p className="futures-form-error" role="alert"><ShieldAlert size={15} aria-hidden="true" /> {formError}</p>}
          <button type="submit" className={`futures-submit-button ${side}`} disabled={Boolean(selectedPosition) || feedStatus === 'connecting' || markPrice <= 0}>
            {selectedPosition ? 'Position already open' : `Open ${side}`}
          </button>
          <p className="form-help">Margin is reserved from your virtual balance. Closing fees are applied when the position exits.</p>
        </form>

        <div className="futures-market-column">
          <section className="futures-market-card">
              <div className="futures-market-card-header">
              <div className="futures-order-asset"><img src={selectedCoin.image} alt="" /><div><strong>{selectedCoin.name}</strong><span>{selectedCoin.symbol.toUpperCase()} / USD</span></div></div>
              <span className="futures-market-feed"><RadioTower size={14} aria-hidden="true" /> {feedStatus === 'live' ? 'Live' : 'Snapshot'}</span>
            </div>
            <div className="futures-large-price"><span>Mark price</span><strong>{formatCurrency(markPrice, 'usd')}</strong><span className={(selectedCoin.price_change_percentage_24h ?? 0) >= 0 ? 'text-up' : 'text-down'}>{formatPercent(selectedCoin.price_change_percentage_24h)} 24h</span></div>
            <div className="futures-market-stats"><div><span>24h high</span><strong>{formatCurrency(selectedCoin.high_24h, 'usd')}</strong></div><div><span>24h low</span><strong>{formatCurrency(selectedCoin.low_24h, 'usd')}</strong></div><div><span>Margin mode</span><strong>Isolated</strong></div></div>
            <div className="futures-market-note"><Activity size={15} aria-hidden="true" /><p>The mark price updates your P&amp;L and checks your stop and target. Entries use the current mark price.</p></div>
          </section>

          <section className="holdings-panel futures-positions-card" aria-labelledby="futures-positions-title">
            <div className="section-heading compact-heading"><div><span className="eyebrow">Current positions</span><h2 id="futures-positions-title">Open positions</h2></div><span className="section-count">{openPositions.length} active</span></div>
            {openPositions.length === 0 ? (
              <div className="futures-empty"><CircleDollarSign size={20} aria-hidden="true" /><h3>No open positions</h3><p>Choose a direction and margin to start a simulated trade.</p></div>
            ) : (
              <div className="futures-position-list">
                {openPositions.map((position) => {
                  const positionMark = marks.get(position.coinId) ?? position.entryPrice;
                  const pnl = getFuturesUnrealizedPnl(position, positionMark);
                  const liquidationPrice = getFuturesLiquidationPrice(position);
                  const positionCoin = futuresCoins.find((coin) => coin.id === position.coinId);
                  return (
                    <article className="futures-position-row" key={position.id}>
                      <div className="futures-position-heading"><div className="futures-order-asset"><img src={positionCoin?.image ?? ''} alt="" /><div><strong>{position.coinName}</strong><span>{position.symbol.toUpperCase()} · {position.leverage}x</span></div></div><span className={`signal-badge ${position.side}`}>{position.side}</span></div>
                      <div className="futures-position-values"><div><span>Entry</span><strong>{formatCurrency(position.entryPrice, 'usd')}</strong></div><div><span>Mark</span><strong>{formatCurrency(positionMark, 'usd')}</strong></div><div><span>Stop loss</span><strong className="text-down">{position.stopLoss != null ? formatCurrency(position.stopLoss, 'usd') : '—'}</strong></div><div><span>Take profit</span><strong className="text-up">{position.takeProfit != null ? formatCurrency(position.takeProfit, 'usd') : '—'}</strong></div><div><span>Liquidation</span><strong>{formatCurrency(liquidationPrice, 'usd')}</strong></div><div><span>P&amp;L</span><strong className={pnl >= 0 ? 'text-up' : 'text-down'}>{formatCurrency(pnl, 'usd')}</strong></div></div>
                      <div className="futures-position-footer"><span>{position.quantity.toPrecision(6)} {position.symbol.toUpperCase()} · {formatCurrency(position.margin, 'usd')} margin</span><button type="button" className="futures-close-button" onClick={() => closeSelectedPosition(position.id, positionMark)} disabled={!positionMark}><X size={14} aria-hidden="true" /> Close position</button></div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </section>

      <section className="holdings-panel futures-trades-card" aria-labelledby="futures-trades-title">
        <div className="section-heading compact-heading"><div><span className="eyebrow">Trade history</span><h2 id="futures-trades-title">Recent simulated trades</h2></div><Link className="text-link" to="/history">View History <ArrowRight size={14} aria-hidden="true" /></Link></div>
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
