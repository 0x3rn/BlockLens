import React from 'react';
import { Activity, BarChart3, Bitcoin, Building2, Coins, TrendingUp } from 'lucide-react';
import { useMarket } from '../context/MarketContext';
import { formatCompactCurrency, formatDateTime, formatNumber, formatPercent } from '../utils/format';
import '../styles/MarketData.css';

const MarketData: React.FC = () => {
  const { metrics, loading, currency, lastUpdated } = useMarket();

  if (loading && !metrics) {
    return (
      <section className="market-data-panel market-data-skeleton" aria-label="Loading global market data">
        <div className="skeleton-line skeleton-title" />
        <div className="metrics-grid">
          {Array.from({ length: 6 }).map((_, index) => <div className="metric-card skeleton-card" key={index} />)}
        </div>
      </section>
    );
  }

  if (!metrics) return null;

  const metricItems = [
    { label: 'Total Market Cap', value: formatCompactCurrency(metrics.totalMarketCap, currency), icon: Coins },
    { label: '24h Volume', value: formatCompactCurrency(metrics.totalVolume24h, currency), icon: BarChart3 },
    {
      label: 'Market Cap (24h)',
      value: formatPercent(metrics.marketCapChange24h),
      icon: TrendingUp,
      tone: metrics.marketCapChange24h >= 0 ? 'up' : 'down',
    },
    { label: 'BTC Dominance', value: formatPercent(metrics.bitcoinDominance, false), icon: Bitcoin },
    { label: 'Active Assets', value: formatNumber(metrics.activeCryptocurrencies), icon: Activity },
    { label: 'Tracked Markets', value: formatNumber(metrics.trackedMarkets), icon: Building2 },
  ];

  return (
    <section className="market-data-panel" aria-labelledby="market-overview-title">
      <div className="panel-heading-row">
        <h2 className="panel-title" id="market-overview-title">Global Market Overview</h2>
        <span className="data-timestamp">CoinGecko · {formatDateTime(lastUpdated ?? metrics.updatedAt)}</span>
      </div>
      <div className="metrics-grid">
        {metricItems.map(({ label, value, icon: Icon, tone }) => (
          <div className="metric-card" key={label}>
            <span className="metric-icon" aria-hidden="true"><Icon size={15} /></span>
            <span className="metric-label">{label}</span>
            <span className={`metric-value ${tone ?? ''}`}>{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
};

export default MarketData;
