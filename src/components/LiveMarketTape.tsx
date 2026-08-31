import React from 'react';
import { Activity, RefreshCw, Zap } from 'lucide-react';
import { useBinanceLiveFeed } from '../hooks/useBinanceLiveFeed';
import { formatCompactCurrency, formatCurrency } from '../utils/format';
import '../styles/LiveMarketTape.css';

const formatTime = (timestamp: number) => new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
}).format(timestamp);

const LiveMarketTape: React.FC = () => {
  const { trades, liquidations, sessionTotals, status, retry } = useBinanceLiveFeed();
  const hasConnectionIssue = status === 'reconnecting' || status === 'unavailable';

  return (
    <section className="live-market-tape" aria-labelledby="live-market-title">
      <div className="live-tape-heading">
        <div>
          <span className="eyebrow"><Activity size={14} aria-hidden="true" /> Exchange activity</span>
          <h2 id="live-market-title">Live Market Tape</h2>
          <p>Real trade prints and forced orders—not estimated dashboard figures.</p>
        </div>
        <div className="live-tape-source">
          <span className={`stream-status ${status}`}><i aria-hidden="true" />{status}</span>
          <small>Binance · live WebSocket</small>
          {hasConnectionIssue && (
            <button type="button" onClick={retry}><RefreshCw size={13} aria-hidden="true" /> Reconnect</button>
          )}
        </div>
      </div>

      <div className="live-tape-grid">
        <article className="tape-column" aria-labelledby="spot-tape-title">
          <div className="tape-column-heading">
            <div><span>Spot trades</span><strong id="spot-tape-title">BTC / USDT</strong></div>
            <span className="source-pill">Spot</span>
          </div>
          <div className="tape-table-head" aria-hidden="true"><span>Side / time</span><span>Price</span><span>Value</span></div>
          <div className="tape-rows" aria-live="off">
            {trades.length > 0 ? trades.slice(0, 6).map((trade) => (
              <div className="tape-row" key={trade.id}>
                <span className={`tape-side ${trade.side}`}><b>{trade.side}</b><small>{formatTime(trade.timestamp)}</small></span>
                <strong>{formatCurrency(trade.price, 'usd')}</strong>
                <span>{formatCompactCurrency(trade.quoteValue, 'usd')}</span>
              </div>
            )) : <div className="tape-empty"><span /> Waiting for the next BTC trade…</div>}
          </div>
        </article>

        <article className="tape-column" aria-labelledby="liquidation-tape-title">
          <div className="tape-column-heading">
            <div><span>Forced liquidations</span><strong id="liquidation-tape-title">USD-M markets</strong></div>
            <span className="source-pill danger"><Zap size={11} aria-hidden="true" /> Futures</span>
          </div>
          <div className="liquidation-session" aria-label="Liquidations observed since this page loaded">
            <span>Session observed</span>
            <strong className="text-down">Long {formatCompactCurrency(sessionTotals.long, 'usd')}</strong>
            <strong className="text-up">Short {formatCompactCurrency(sessionTotals.short, 'usd')}</strong>
          </div>
          <div className="tape-table-head liquidation-head" aria-hidden="true"><span>Position / time</span><span>Market</span><span>Value</span></div>
          <div className="tape-rows" aria-live="off">
            {liquidations.length > 0 ? liquidations.slice(0, 5).map((item) => (
              <div className="tape-row" key={item.id}>
                <span className={`tape-side ${item.side}`}><b>{item.side}</b><small>{formatTime(item.timestamp)}</small></span>
                <strong>{item.symbol.replace('USDT', '/USDT')}</strong>
                <span>{formatCompactCurrency(item.quoteValue, 'usd')}</span>
              </div>
            )) : <div className="tape-empty"><span /> Waiting for a forced-order event…</div>}
          </div>
        </article>
      </div>

      <p className="tape-footnote">Binance exchange activity only. Liquidation totals cover events observed during this browser session and reset on reload; they are not market-wide 24-hour totals.</p>
    </section>
  );
};

export default LiveMarketTape;
