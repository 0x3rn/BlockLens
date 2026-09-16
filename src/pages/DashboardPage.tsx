import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bot, GitCompareArrows, RadioTower, Radar, Star } from 'lucide-react';
import CoinTable from '../components/CoinTable';
import { DataState } from '../components/DataState';
import MarketData from '../components/MarketData';
import LiveMarketTape from '../components/LiveMarketTape';
import MarketLens from '../components/MarketLens';
import TrendingCoins from '../components/TrendingCoins';
import { useMarket } from '../context/MarketContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { formatCurrency, formatPercent } from '../utils/format';

const DashboardPage: React.FC = () => {
  const { coins, loading, error, refresh, currency, watchlist } = useMarket();
  usePageMeta('Dashboard', 'Track global crypto markets, leading assets, price movers, and your watchlist.');

  const movers = useMemo(() => {
    const withChanges = coins.filter((coin) => coin.price_change_percentage_24h != null);
    return {
      gainers: [...withChanges].sort((a, b) => (b.price_change_percentage_24h ?? 0) - (a.price_change_percentage_24h ?? 0)).slice(0, 3),
      losers: [...withChanges].sort((a, b) => (a.price_change_percentage_24h ?? 0) - (b.price_change_percentage_24h ?? 0)).slice(0, 3),
    };
  }, [coins]);

  return (
    <main className="app-container page-stack">
      <header className="page-intro dashboard-intro">
        <div className="dashboard-hero-copy">
          <span className="eyebrow"><Radar size={14} aria-hidden="true" /> Live crypto market data</span>
          <h1>Track crypto markets <span>in real time.</span></h1>
          <p>Track prices, monitor liquidations, compare assets, and review historical market data.</p>
          <div className="page-actions">
            <Link className="primary-button" to="/markets">Explore markets <ArrowRight size={16} aria-hidden="true" /></Link>
            <Link className="secondary-button" to="/analysis"><Bot size={16} aria-hidden="true" /> Analyze a coin</Link>
          </div>
          <div className="hero-proof" aria-label="BlockLens capabilities">
            <span><i aria-hidden="true" /> Live market data</span>
            <span>Portfolio tracking</span>
            <span>AI market analysis</span>
          </div>
        </div>
        <MarketLens coins={coins} currency={currency} />
      </header>

      {error && coins.length > 0 && (
        <DataState title="Showing the last available snapshot" message={error} onRetry={refresh} compact />
      )}
      {error && coins.length === 0 ? (
        <>
          <DataState title="Market snapshot unavailable" message={error} onRetry={refresh} compact />
          <section className="feed-resilience-note" aria-labelledby="feed-resilience-title">
            <span className="feed-resilience-icon"><RadioTower size={18} aria-hidden="true" /></span>
            <div><span className="eyebrow">Limited market data</span><h2 id="feed-resilience-title">Some market data is temporarily unavailable</h2><p>Live trade activity may still be available while the market overview reconnects. Your saved portfolio and watchlist are unaffected</p></div>
            <Link className="text-link" to="/watchlist">Open portfolio <ArrowRight size={14} aria-hidden="true" /></Link>
          </section>
          <LiveMarketTape />
        </>
      ) : (
        <>
          <MarketData />
          <LiveMarketTape />
          <div className="dashboard-feature-grid">
            <TrendingCoins />
            <section className="movers-panel" aria-labelledby="movers-title">
              <div className="section-heading compact-heading">
                <div>
                  <span className="eyebrow">24-hour movement</span>
                  <h2 id="movers-title">Market movers</h2>
                </div>
              </div>
              <div className="mover-columns">
                <div>
                  <span className="mover-column-title text-up">Top gainers</span>
                  {movers.gainers.map((coin) => (
                    <Link to={`/coin/${coin.id}`} className="mover-row" key={coin.id}>
                      <span><img src={coin.image} alt="" /> {coin.symbol.toUpperCase()}</span>
                      <strong className="text-up">{formatPercent(coin.price_change_percentage_24h)}</strong>
                    </Link>
                  ))}
                </div>
                <div>
                  <span className="mover-column-title text-down">Top losers</span>
                  {movers.losers.map((coin) => (
                    <Link to={`/coin/${coin.id}`} className="mover-row" key={coin.id}>
                      <span><img src={coin.image} alt="" /> {coin.symbol.toUpperCase()}</span>
                      <strong className="text-down">{formatPercent(coin.price_change_percentage_24h)}</strong>
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <section className="quick-actions" aria-label="BlockLens tools">
            <Link to="/watchlist" className="quick-action-card">
              <span className="quick-action-icon"><Star size={18} aria-hidden="true" /></span>
              <span><strong>{watchlist.length} watched assets</strong><small>Portfolio, cost basis, and alerts</small></span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link to="/compare" className="quick-action-card">
              <span className="quick-action-icon purple"><GitCompareArrows size={18} aria-hidden="true" /></span>
              <span><strong>Compare assets</strong><small>Compare price performance over time</small></span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            {coins[0] && (
              <Link to={`/coin/${coins[0].id}`} className="quick-action-card">
                <img className="quick-coin-image" src={coins[0].image} alt="" />
                <span><strong>{coins[0].name}</strong><small>{formatCurrency(coins[0].current_price, currency)} · Highest market cap</small></span>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            )}
          </section>

          <section>
            <div className="section-heading">
              <div>
                <span className="eyebrow">Market leaders</span>
                <h2>Top assets by market cap</h2>
              </div>
              <Link className="text-link" to="/markets">View all 100 <ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
            {loading && coins.length === 0 ? <div className="table-skeleton" /> : <CoinTable coins={coins} compact pageSize={12} />}
          </section>
        </>
      )}
    </main>
  );
};

export default DashboardPage;
