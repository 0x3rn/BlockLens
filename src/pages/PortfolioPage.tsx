import React, { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  BellRing,
  Download,
  Pencil,
  Plus,
  ShieldCheck,
  Star,
  Trash2,
  Upload,
  WalletCards,
} from 'lucide-react';
import { useMarket } from '../context/MarketContext';
import { useAuth } from '../context/AuthContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { AlertCondition, CurrencyCode } from '../types/crypto';
import { formatCurrency, formatDateTime, formatPercent } from '../utils/format';

const PortfolioPage: React.FC = () => {
  const {
    coins,
    currency,
    watchlist,
    toggleWatchlist,
    positions,
    upsertPosition,
    removePosition,
    alerts,
    addAlert,
    removeAlert,
  } = useMarket();
  const { user } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const initialCoinId = searchParams.get('coin') ?? coins[0]?.id ?? '';
  const [positionCoinId, setPositionCoinId] = useState(initialCoinId);
  const [quantity, setQuantity] = useState('');
  const [averageCost, setAverageCost] = useState('');
  const [alertCoinId, setAlertCoinId] = useState(initialCoinId);
  const [condition, setCondition] = useState<AlertCondition>('above');
  const [threshold, setThreshold] = useState('');
  const [importMessage, setImportMessage] = useState<string | null>(null);
  usePageMeta('Portfolio & Alerts', 'Track a device-local crypto portfolio, maintain a watchlist, and monitor price or movement thresholds.');

  useEffect(() => {
    const requestedId = searchParams.get('coin');
    const fallbackId = requestedId && coins.some((coin) => coin.id === requestedId) ? requestedId : coins[0]?.id;
    if (!fallbackId) return;
    setPositionCoinId((current) => current || fallbackId);
    setAlertCoinId((current) => current || fallbackId);
  }, [coins, searchParams]);

  useEffect(() => {
    if (location.hash !== '#alerts') return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('alerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash]);

  const holdings = useMemo(() => positions.map((position) => ({
    position,
    coin: coins.find((coin) => coin.id === position.coinId),
  })), [coins, positions]);

  const matchingHoldings = holdings.filter(({ position, coin }) => coin && position.currency === currency);
  const totals = matchingHoldings.reduce((summary, { position, coin }) => {
    if (!coin) return summary;
    const currentValue = coin.current_price * position.quantity;
    const costValue = position.averageCost * position.quantity;
    return {
      currentValue: summary.currentValue + currentValue,
      costValue: summary.costValue + costValue,
    };
  }, { currentValue: 0, costValue: 0 });
  const totalPnl = totals.currentValue - totals.costValue;
  const totalPnlPercent = totals.costValue > 0 ? (totalPnl / totals.costValue) * 100 : 0;
  const watchedCoins = coins.filter((coin) => watchlist.includes(coin.id));
  const unavailableWatchIds = watchlist.filter((id) => !coins.some((coin) => coin.id === id));

  const submitPosition = (event: FormEvent) => {
    event.preventDefault();
    const parsedQuantity = Number(quantity);
    const parsedCost = Number(averageCost);
    if (!positionCoinId || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || !Number.isFinite(parsedCost) || parsedCost < 0) return;
    upsertPosition({ coinId: positionCoinId, quantity: parsedQuantity, averageCost: parsedCost, currency });
    setQuantity('');
    setAverageCost('');
  };

  const editPosition = (coinId: string) => {
    const position = positions.find((item) => item.coinId === coinId);
    if (!position) return;
    setPositionCoinId(position.coinId);
    setQuantity(String(position.quantity));
    setAverageCost(String(position.averageCost));
    document.getElementById('position-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const submitAlert = (event: FormEvent) => {
    event.preventDefault();
    const parsedThreshold = Number(threshold);
    if (!alertCoinId || !Number.isFinite(parsedThreshold) || parsedThreshold <= 0) return;
    addAlert(alertCoinId, condition, parsedThreshold, currency);
    setThreshold('');
  };

  const exportPortfolio = () => {
    const lines = [
      'coin_id,quantity,average_cost,currency,updated_at',
      ...positions.map((position) => [
        position.coinId,
        position.quantity,
        position.averageCost,
        position.currency,
        position.updatedAt,
      ].join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `blocklens-portfolio-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importPortfolio = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 250_000) {
      setImportMessage('This CSV is too large. Import a BlockLens export smaller than 250 KB.');
      event.target.value = '';
      return;
    }
    try {
      const rows = (await file.text()).trim().split(/\r?\n/).slice(1, 501);
      let imported = 0;
      rows.forEach((row) => {
        const [coinId, quantityValue, costValue, currencyValue] = row.split(',').map((value) => value.trim());
        const parsedQuantity = Number(quantityValue);
        const parsedCost = Number(costValue);
        if (
          /^[a-z0-9-]{1,100}$/.test(coinId)
          && Number.isFinite(parsedQuantity)
          && parsedQuantity > 0
          && Number.isFinite(parsedCost)
          && parsedCost >= 0
          && ['usd', 'eur', 'gbp', 'ngn'].includes(currencyValue)
        ) {
          upsertPosition({
            coinId,
            quantity: parsedQuantity,
            averageCost: parsedCost,
            currency: currencyValue as CurrencyCode,
          });
          imported += 1;
        }
      });
      setImportMessage(`${imported} position${imported === 1 ? '' : 's'} imported.`);
    } catch {
      setImportMessage('This CSV could not be imported. Use a file exported by BlockLens.');
    } finally {
      event.target.value = '';
    }
  };

  return (
    <main className="app-container page-stack">
      <header className="markets-header page-header-card">
        <div className="markets-title-wrap">
          <span className="markets-icon portfolio-icon"><WalletCards size={25} aria-hidden="true" /></span>
          <div>
            <span className="eyebrow">{user ? 'Synced account' : 'Saved on this device'}</span>
            <h1>Portfolio & Alerts</h1>
            <p>{user ? 'Track quantities, cost basis, watchlist assets, and alerts across your devices.' : 'Track quantities and cost basis locally. Sign in to sync this portfolio across devices.'}</p>
          </div>
        </div>
        <div className="portfolio-file-actions">
          <button type="button" className="secondary-button" onClick={exportPortfolio} disabled={positions.length === 0}>
            <Download size={15} aria-hidden="true" /> Export CSV
          </button>
          <label className="secondary-button file-button">
            <Upload size={15} aria-hidden="true" /> Import CSV
            <input type="file" accept=".csv,text/csv" onChange={(event) => void importPortfolio(event)} />
          </label>
        </div>
      </header>
      {importMessage && <div className="inline-notice" role="status">{importMessage}</div>}

      <section className="portfolio-summary" aria-label="Portfolio summary">
        <div><span>Current value ({currency.toUpperCase()})</span><strong>{formatCurrency(totals.currentValue, currency)}</strong></div>
        <div><span>Cost basis</span><strong>{formatCurrency(totals.costValue, currency)}</strong></div>
        <div><span>Unrealized P&amp;L</span><strong className={totalPnl >= 0 ? 'text-up' : 'text-down'}>{formatCurrency(totalPnl, currency)} · {formatPercent(totalPnlPercent)}</strong></div>
        <div><span>Tracked positions</span><strong>{positions.length}</strong></div>
      </section>
      {positions.some((position) => position.currency !== currency) && (
        <div className="inline-notice"><ShieldCheck size={16} aria-hidden="true" /> Totals include only positions whose cost basis was recorded in {currency.toUpperCase()}. Switch currency to review the others accurately.</div>
      )}

      <section className="portfolio-layout">
        <form className="form-card" id="position-form" onSubmit={submitPosition}>
          <div className="section-heading compact-heading"><div><span className="eyebrow">Holdings</span><h2>Add or update position</h2></div></div>
          <label><span>Asset</span><select value={positionCoinId} onChange={(event) => setPositionCoinId(event.target.value)} required>
            <option value="" disabled>Select an asset</option>
            {coins.map((coin) => <option value={coin.id} key={coin.id}>{coin.name} ({coin.symbol.toUpperCase()})</option>)}
          </select></label>
          <div className="form-row">
            <label><span>Quantity</span><input type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="0.00" required /></label>
            <label><span>Average cost ({currency.toUpperCase()})</span><input type="number" min="0" step="any" value={averageCost} onChange={(event) => setAverageCost(event.target.value)} placeholder="0.00" required /></label>
          </div>
          <button type="submit" className="primary-button"><Plus size={16} aria-hidden="true" /> Save position</button>
          <p className="form-help">Saving an existing asset replaces its quantity and cost basis.</p>
        </form>

        <section className="holdings-panel" aria-labelledby="holdings-title">
          <div className="section-heading compact-heading"><div><span className="eyebrow">Your positions</span><h2 id="holdings-title">Holdings</h2></div></div>
          {holdings.length === 0 ? (
            <div className="mini-empty"><WalletCards size={28} aria-hidden="true" /><h3>No positions yet</h3><p>Add a quantity and cost basis to calculate portfolio value and P&amp;L.</p></div>
          ) : (
            <div className="holding-list">
              {holdings.map(({ position, coin }) => {
                const matchesCurrency = position.currency === currency;
                const currentValue = coin ? coin.current_price * position.quantity : null;
                const cost = position.averageCost * position.quantity;
                const pnl = matchesCurrency && currentValue != null ? currentValue - cost : null;
                return (
                  <article className="holding-row" key={position.coinId}>
                    <div className="holding-asset">
                      {coin ? <img src={coin.image} alt="" /> : <span className="missing-coin-icon">?</span>}
                      <span><strong>{coin?.name ?? position.coinId}</strong><small>{position.quantity.toLocaleString()} units · cost in {position.currency.toUpperCase()}</small></span>
                    </div>
                    <div><span>Current value</span><strong>{matchesCurrency ? formatCurrency(currentValue, currency) : 'Switch currency'}</strong></div>
                    <div><span>P&amp;L</span><strong className={(pnl ?? 0) >= 0 ? 'text-up' : 'text-down'}>{pnl == null ? 'N/A' : formatCurrency(pnl, currency)}</strong></div>
                    <div className="row-actions">
                      <button type="button" onClick={() => editPosition(position.coinId)} aria-label={`Edit ${coin?.name ?? position.coinId} position`}><Pencil size={15} /></button>
                      <button type="button" onClick={() => removePosition(position.coinId)} aria-label={`Remove ${coin?.name ?? position.coinId} position`}><Trash2 size={15} /></button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>

      <section aria-labelledby="watchlist-title">
        <div className="section-heading"><div><span className="eyebrow"><Star size={13} /> Saved assets</span><h2 id="watchlist-title">Watchlist</h2></div><span className="section-count">{watchlist.length} assets</span></div>
        {watchlist.length === 0 ? (
          <div className="portfolio-empty"><Star size={38} /><h3>Your watchlist is empty</h3><p>Add assets from Markets using the star button.</p><Link className="primary-button" to="/markets">Browse markets</Link></div>
        ) : (
          <div className="portfolio-grid">
            {watchedCoins.map((coin) => (
              <article className="portfolio-card" key={coin.id}>
                <Link to={`/coin/${coin.id}`} className="portfolio-card-link" aria-label={`Open ${coin.name}`}>
                  <div className="portfolio-card-top"><img src={coin.image} alt="" className="portfolio-coin-img" /><div className="portfolio-coin-info"><span className="portfolio-coin-name">{coin.name}</span><span className="portfolio-coin-symbol">{coin.symbol.toUpperCase()}</span></div><span className="portfolio-rank">#{coin.market_cap_rank}</span></div>
                  <div className="portfolio-card-price"><span className="portfolio-price">{formatCurrency(coin.current_price, currency)}</span><span className={`portfolio-change ${(coin.price_change_percentage_24h ?? 0) >= 0 ? 'up' : 'down'}`}>{formatPercent(coin.price_change_percentage_24h)}</span></div>
                </Link>
                <button type="button" className="remove-watch-button" onClick={() => toggleWatchlist(coin.id)}><Trash2 size={14} /> Remove</button>
              </article>
            ))}
            {unavailableWatchIds.map((id) => (
              <article className="portfolio-card unavailable-card" key={id}><div><strong>{id}</strong><p>Outside the current top-100 snapshot. It remains saved.</p></div><button type="button" className="remove-watch-button" onClick={() => toggleWatchlist(id)}><Trash2 size={14} /> Remove</button></article>
            ))}
          </div>
        )}
      </section>

      <section id="alerts" className="alerts-section" aria-labelledby="alerts-title">
        <div className="section-heading"><div><span className="eyebrow"><BellRing size={13} /> While BlockLens is open</span><h2 id="alerts-title">Price alerts</h2></div><span className="section-count">{alerts.length} rules</span></div>
        <div className="alerts-layout">
          <form className="form-card alert-form" onSubmit={submitAlert}>
            <label><span>Asset</span><select value={alertCoinId} onChange={(event) => setAlertCoinId(event.target.value)} required><option value="" disabled>Select an asset</option>{coins.map((coin) => <option value={coin.id} key={coin.id}>{coin.name}</option>)}</select></label>
            <label><span>Condition</span><select value={condition} onChange={(event) => setCondition(event.target.value as AlertCondition)}><option value="above">Price rises above</option><option value="below">Price falls below</option><option value="change">Absolute 24h move reaches</option></select></label>
            <label><span>{condition === 'change' ? 'Percentage threshold' : `Price threshold (${currency.toUpperCase()})`}</span><input type="number" min="0" step="any" value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder={condition === 'change' ? '5' : '1000'} required /></label>
            <button type="submit" className="primary-button"><BellRing size={16} /> Add alert</button>
            <p className="form-help">Alerts are evaluated on the 60-second refresh while this site is open; they are not background notifications.</p>
          </form>
          <div className="alert-list">
            {alerts.length === 0 ? <div className="mini-empty"><BellRing size={28} /><h3>No alert rules</h3><p>Create a threshold to highlight movement while you monitor BlockLens.</p></div> : alerts.map((alert) => {
              const coin = coins.find((item) => item.id === alert.coinId);
              const description = alert.condition === 'change'
                ? `24h move reaches ${alert.threshold}%`
                : `Price ${alert.condition} ${formatCurrency(alert.threshold, alert.currency)}`;
              return <article className={`alert-row ${alert.triggeredAt ? 'triggered' : ''}`} key={alert.id}><span className="alert-status"><BellRing size={16} /></span><div><strong>{coin?.name ?? alert.coinId}</strong><span>{description}</span><small>{alert.triggeredAt ? `Triggered ${formatDateTime(alert.triggeredAt)}` : `Created ${formatDateTime(alert.createdAt)}`}</small></div><button type="button" onClick={() => removeAlert(alert.id)} aria-label={`Delete ${coin?.name ?? alert.coinId} alert`}><Trash2 size={15} /></button></article>;
            })}
          </div>
        </div>
      </section>
    </main>
  );
};

export default PortfolioPage;
