import React, { useMemo } from 'react';
import { ArrowRight, Bot, History as HistoryIcon, WalletCards } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMarket } from '../context/MarketContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { formatCurrency, formatDateTime } from '../utils/format';
import { analysisModeDefinitions } from '../config/analysisModes';
import { analysisProfileDefinitions } from '../config/analysisProfiles';

type HistoryView = 'analysis' | 'positions' | 'futures';

const fallbackCoinName = (coinId: string) => coinId
  .split('-')
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const HistoryPage: React.FC = () => {
  const { aiHistory, positionHistory, positions, coins, paperFutures } = useMarket();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const view: HistoryView = requestedView === 'positions' || requestedView === 'futures' ? requestedView : 'analysis';
  const setView = (next: HistoryView) => setSearchParams((previous) => {
    const params = new URLSearchParams(previous);
    params.set('view', next);
    return params;
  });
  usePageMeta('History', 'Review your AI briefs, portfolio activity, and paper trades.');

  const latestAnalysis = useMemo(() => aiHistory.slice(0, 50), [aiHistory]);
  const latestPositions = useMemo(() => positionHistory.slice(0, 100), [positionHistory]);

  return (
    <main className="app-container page-stack history-page">
      <header className="markets-header page-header-card history-header">
        <div className="markets-title-wrap">
          <span className="markets-icon history-icon"><HistoryIcon size={25} aria-hidden="true" /></span>
          <div>
            <span className="eyebrow">Activity archive</span>
            <h1>History</h1>
            <p>Review your AI briefs, portfolio activity, and paper trades.</p>
          </div>
        </div>
        <div className="markets-stats history-stats">
          <div className="markets-stat-item"><span className="stat-label">AI briefs</span><strong>{aiHistory.length}</strong></div>
          <div className="markets-stat-item"><span className="stat-label">Open positions</span><strong>{positions.length}</strong></div>
        </div>
      </header>

      <div className="history-tabs" role="tablist" aria-label="History views">
        <button type="button" role="tab" aria-selected={view === 'futures'} className={view === 'futures' ? 'is-active' : ''} onClick={() => setView('futures')}>
          <HistoryIcon size={15} aria-hidden="true" /> Paper trades <span>{paperFutures.trades.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'analysis'}
          className={view === 'analysis' ? 'is-active' : ''}
          onClick={() => setView('analysis')}
        >
          <Bot size={15} aria-hidden="true" />
          AI briefs
          <span>{aiHistory.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'positions'}
          className={view === 'positions' ? 'is-active' : ''}
          onClick={() => setView('positions')}
        >
          <WalletCards size={15} aria-hidden="true" />
          Position activity
          <span>{positionHistory.length}</span>
        </button>
      </div>

      {view === 'futures' ? (
        <section className="history-section" role="tabpanel" aria-label="Paper trade history">
          <div className="section-heading compact-heading">
            <div><span className="eyebrow">Paper trading</span><h2>Trade history</h2></div>
            <Link className="text-link" to="/futures">Open Trade <ArrowRight size={14} aria-hidden="true" /></Link>
          </div>
          {paperFutures.trades.length === 0 ? (
            <div className="history-empty"><HistoryIcon size={20} aria-hidden="true" /><h3>No paper trades yet</h3><p>Your simulated trades will appear here.</p></div>
          ) : (
            <div className="history-list">
              {paperFutures.trades.map((trade) => (
                <article className="history-card" key={trade.id}>
                  <div className="history-card-main">
                    <div className="history-card-topline">
                      <div className="history-asset-label"><strong>{trade.coinName}</strong><span>{trade.symbol.toUpperCase()} · {trade.side} · {trade.action.replaceAll('-', ' ')}</span></div>
                      <time dateTime={trade.createdAt}>{formatDateTime(trade.createdAt)}</time>
                    </div>
                    <div className="position-history-values">
                      <div><span>Quantity</span><strong>{trade.quantity.toLocaleString('en-US', { maximumSignificantDigits: 8 })}</strong></div>
                      <div><span>Price</span><strong>{formatCurrency(trade.price, 'usd')}</strong></div>
                      <div><span>Fee</span><strong>{formatCurrency(trade.fee, 'usd')}</strong></div>
                      <div><span>{trade.action === 'open' ? 'Entry cost' : 'Realized P&L'}</span><strong>{formatCurrency(trade.action === 'open' ? -trade.fee : trade.realizedPnl, 'usd')}</strong></div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : view === 'analysis' ? (
        <section className="history-section" role="tabpanel" aria-label="AI brief history">
          <div className="section-heading compact-heading">
            <div><span className="eyebrow">Saved research</span><h2>Previous AI briefs</h2></div>
            <span className="section-count">Newest first</span>
          </div>
          {latestAnalysis.length === 0 ? (
            <div className="history-empty">
              <Bot size={20} aria-hidden="true" />
              <h3>No AI briefs yet</h3>
              <p>Generate a trading analysis to keep the brief here.</p>
              <Link className="text-link" to="/analysis">Open AI analysis <ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
          ) : (
            <div className="history-list">
              {latestAnalysis.map((entry) => {
                const setup = entry.analysis.tradeSetup;
                return (
                  <article className="history-card history-analysis-card" key={entry.id}>
                    <div className="history-card-main">
                      <div className="history-card-topline">
                        <div className="history-asset-label">
                          <strong>{entry.coinName}</strong>
                          <span>{entry.coinSymbol.toUpperCase()}</span>
                        </div>
                        <span className={`stance-badge ${entry.analysis.stance}`}>{entry.analysis.stance} bias</span>
                      </div>
                      <h3>{entry.analysis.headline}</h3>
                      <p className="history-summary">{entry.analysis.summary}</p>
                      <div className="history-meta-row">
                        <span className={`signal-badge ${setup.signal}`}>{setup.signal === 'no-trade' ? 'No trade' : setup.signal}</span>
                        <span>{analysisProfileDefinitions[entry.analysis.riskProfile ?? 'conservative'].label} · {analysisModeDefinitions[entry.analysis.mode ?? 'swing'].label}</span>
                        <span>{entry.analysis.confidence}% confidence</span>
                        <span>{formatCurrency(entry.price, entry.currency)}</span>
                        <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                      </div>
                    </div>
                    <div className="history-card-action">
                      <Link className="text-link" to={`/analysis?coin=${entry.coinId}&mode=${entry.analysis.mode ?? 'swing'}&profile=${entry.analysis.riskProfile ?? 'conservative'}`}>Review asset <ArrowRight size={14} aria-hidden="true" /></Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="history-section" role="tabpanel" aria-label="Position activity history">
          {positions.length > 0 && (
            <section className="history-current-section" aria-labelledby="current-positions-title">
              <div className="section-heading compact-heading">
                <div><span className="eyebrow">Live portfolio</span><h2 id="current-positions-title">Current positions</h2></div>
                <Link className="text-link" to="/watchlist">Open portfolio <ArrowRight size={14} aria-hidden="true" /></Link>
              </div>
              <div className="history-current-list">
                {positions.map((position) => {
                  const coin = coins.find((item) => item.id === position.coinId);
                  return (
                    <article className="history-card current-position-card" key={`${position.coinId}-${position.currency}`}>
                      <div className="history-card-main">
                        <div className="history-asset-label">
                          <strong>{coin?.name ?? fallbackCoinName(position.coinId)}</strong>
                          <span>{coin?.symbol?.toUpperCase() ?? position.currency.toUpperCase()}</span>
                        </div>
                        <div className="position-history-values">
                          <div><span>Quantity</span><strong>{position.quantity}</strong></div>
                          <div><span>Average cost</span><strong>{formatCurrency(position.averageCost, position.currency)}</strong></div>
                          <div><span>Updated</span><strong>{formatDateTime(position.updatedAt)}</strong></div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          <div className="section-heading compact-heading">
            <div><span className="eyebrow">Portfolio changes</span><h2>Position activity</h2></div>
            <span className="section-count">Newest first</span>
          </div>
          {latestPositions.length === 0 ? (
            <div className="history-empty">
              <WalletCards size={20} aria-hidden="true" />
              <h3>No position activity yet</h3>
              <p>Add a position to start building your portfolio history.</p>
              <Link className="text-link" to="/watchlist">Open portfolio <ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
          ) : (
            <div className="history-list">
              {latestPositions.map((entry) => (
                <article className={`history-card position-history-card ${entry.action}`} key={entry.id}>
                  <div className="position-history-mark" aria-hidden="true" />
                  <div className="history-card-main">
                    <div className="history-card-topline">
                      <div className="history-asset-label">
                        <strong>{coins.find((coin) => coin.id === entry.coinId)?.name ?? fallbackCoinName(entry.coinId)}</strong>
                        <span>{coins.find((coin) => coin.id === entry.coinId)?.symbol?.toUpperCase() ?? entry.coinId.toUpperCase()} · {entry.action}</span>
                      </div>
                      <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                    </div>
                    <div className="position-history-values">
                      <div><span>Quantity</span><strong>{entry.quantity}</strong></div>
                      <div><span>Average cost</span><strong>{formatCurrency(entry.averageCost, entry.currency)}</strong></div>
                      <div><span>Currency</span><strong>{entry.currency.toUpperCase()}</strong></div>
                    </div>
                  </div>
                  <div className="history-card-action">
                    <Link className="text-link" to={`/watchlist?coin=${entry.coinId}`}>Open portfolio <ArrowRight size={14} aria-hidden="true" /></Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
};

export default HistoryPage;
