import React from 'react';
import { BarChart3, GitCompareArrows } from 'lucide-react';
import { Link } from 'react-router-dom';
import CoinTable from '../components/CoinTable';
import { DataState } from '../components/DataState';
import { useMarket } from '../context/MarketContext';
import { usePageMeta } from '../hooks/usePageMeta';

const MarketsPage: React.FC = () => {
  const { coins, loading, error, refresh, watchlist } = useMarket();
  usePageMeta('Markets', 'Search, filter, sort, and inspect the top 100 cryptocurrencies by market capitalization.');

  return (
    <main className="app-container page-stack">
      <header className="markets-header page-header-card">
        <div className="markets-title-wrap">
          <span className="markets-icon"><BarChart3 size={25} aria-hidden="true" /></span>
          <div>
            <span className="eyebrow">Live CoinGecko snapshot</span>
            <h1>Markets</h1>
            <p>Search and filter the top 100 assets with precise prices and transparent update status.</p>
          </div>
        </div>
        <div className="markets-stats">
          <div className="markets-stat-item"><span className="stat-label">Loaded assets</span><span className="stat-value">{coins.length}</span></div>
          <div className="markets-stat-item"><span className="stat-label">Watchlist</span><span className="stat-value accent">{watchlist.length}</span></div>
          <Link className="secondary-button" to="/compare"><GitCompareArrows size={16} aria-hidden="true" /> Compare</Link>
        </div>
      </header>

      {error && coins.length === 0 ? (
        <DataState message={error} onRetry={() => void refresh()} />
      ) : (
        <>
          {error && <DataState title="Showing cached market data" message={error} onRetry={() => void refresh()} compact />}
          {loading && coins.length === 0 ? <div className="table-skeleton" /> : <CoinTable coins={coins} pageSize={20} />}
        </>
      )}
    </main>
  );
};

export default MarketsPage;
