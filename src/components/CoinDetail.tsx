import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, Bot, ExternalLink, Layers, Star, TrendingUp, WalletCards } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { DataState } from './DataState';
import PriceChart from './PriceChart';
import { useMarket } from '../context/MarketContext';
import { useToast } from '../context/ToastContext';
import { fetchCoinDetail, getApiErrorMessage } from '../services/api';
import { usePageMeta } from '../hooks/usePageMeta';
import { CoinDetail as CoinDetailType } from '../types/crypto';
import { formatCompactCurrency, formatCurrency, formatDate, formatNumber, formatPercent } from '../utils/format';
import '../styles/CoinDetail.css';

const plainText = (value = ''): string => value
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const CoinDetailPage: React.FC = () => {
  const { coinId } = useParams<{ coinId: string }>();
  const { currency, watchlist, toggleWatchlist } = useMarket();
  const { showToast } = useToast();
  const [coin, setCoin] = useState<CoinDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  usePageMeta(
    coin ? `${coin.name} Price & Market Data` : 'Asset Profile',
    coin
      ? `Inspect ${coin.name} price history, market statistics, supply, and scenario-based research tools.`
      : 'Inspect crypto asset price history, market statistics, supply, and research tools.',
  );

  const loadCoin = useCallback(() => {
    if (!coinId) {
      setLoading(false);
      setError('No asset was specified.');
      return Promise.resolve();
    }

    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    return fetchCoinDetail(coinId)
      .then((data) => {
        if (version !== requestVersion.current) return;
        setCoin(data);
      })
      .catch((loadError) => {
        if (version === requestVersion.current) setError(getApiErrorMessage(loadError));
      })
      .finally(() => {
        if (version === requestVersion.current) setLoading(false);
      });

  }, [coinId]);

  useEffect(() => {
    void loadCoin();
    return () => { requestVersion.current += 1; };
  }, [loadCoin]);

  if (loading) {
    return <main className="app-container page-stack"><div className="detail-skeleton" aria-label="Loading asset profile" /></main>;
  }

  if (error || !coin || !coinId) {
    return (
      <main className="app-container page-stack">
        <Link className="back-link" to="/markets"><ArrowLeft size={16} /> Back to markets</Link>
        <DataState title="Asset profile unavailable" message={error ?? 'This asset could not be found.'} onRetry={loadCoin} />
      </main>
    );
  }

  const market = coin.market_data;
  const description = plainText(coin.description?.en);
  const homepage = coin.links?.homepage?.find((url) => /^https?:\/\//i.test(url));
  const isWatched = watchlist.includes(coin.id);
  const changes = [
    ['24 hours', market.price_change_percentage_24h],
    ['7 days', market.price_change_percentage_7d],
    ['30 days', market.price_change_percentage_30d],
    ['90 days', market.price_change_percentage_90d],
    ['180 days', market.price_change_percentage_180d],
    ['1 year', market.price_change_percentage_1y],
  ] as const;
  const highlights = [
    ['Market cap', formatCompactCurrency(market.market_cap[currency], currency)],
    ['24h volume', formatCompactCurrency(market.total_volume[currency], currency)],
    ['24h high', formatCurrency(market.high_24h[currency], currency)],
    ['24h low', formatCurrency(market.low_24h[currency], currency)],
    ['All-time high', formatCurrency(market.ath[currency], currency)],
    ['ATH date', formatDate(market.ath_date[currency])],
    ['All-time low', formatCurrency(market.atl[currency], currency)],
    ['ATL date', formatDate(market.atl_date[currency])],
  ] as const;
  const supply = [
    ['Circulating supply', market.circulating_supply],
    ['Total supply', market.total_supply],
    ['Maximum supply', market.max_supply],
  ] as const;

  return (
    <main className="app-container page-stack coin-detail-container">
      <div className="detail-topline">
        <Link className="back-link" to="/markets"><ArrowLeft size={16} /> Back to markets</Link>
        <span className="data-source-label">Market data by CoinGecko</span>
      </div>

      <header className="coin-detail-header">
        <div className="coin-detail-identity">
          <img src={coin.image.large} alt="" className="coin-detail-img" />
          <div>
            <h1>{coin.name} <span className="coin-detail-symbol">{coin.symbol.toUpperCase()}</span></h1>
          </div>
        </div>
        <span className="coin-detail-rank"><small>Market cap rank</small><strong>#{market.market_cap_rank}</strong></span>
        <div className="coin-detail-price">
          <span className="detail-current-price">{formatCurrency(market.current_price[currency], currency)}</span>
          <span className={`detail-price-change ${(market.price_change_percentage_24h ?? 0) >= 0 ? 'up' : 'down'}`}>
            {formatPercent(market.price_change_percentage_24h)} · 24h
          </span>
        </div>
        <div className="detail-actions">
          <button type="button" className={`secondary-button ${isWatched ? 'is-active' : ''}`} onClick={() => { toggleWatchlist(coin.id); showToast(`${coin.name} ${isWatched ? 'removed from' : 'added to'} your watchlist.`, isWatched ? 'info' : 'success'); }} aria-pressed={isWatched}>
            <Star size={16} fill={isWatched ? 'currentColor' : 'none'} /> {isWatched ? 'Watching' : 'Watch asset'}
          </button>
          <Link className="secondary-button" to={`/watchlist?coin=${coin.id}`}><WalletCards size={16} /> Add position</Link>
          <Link className="primary-button" to={`/analysis?coin=${coin.id}`}><Bot size={16} /> Create AI brief</Link>
        </div>
      </header>

      <section className="coin-detail-chart-section">
        <PriceChart coinId={coin.id} coinName={coin.name} currency={currency} />
      </section>

      <section className="coin-detail-section" aria-labelledby="changes-title">
        <div className="section-heading compact-heading"><div><span className="eyebrow"><TrendingUp size={13} /> Momentum</span><h2 id="changes-title">Price performance</h2></div></div>
        <div className="price-changes-grid">
          {changes.map(([label, value]) => <div className="price-change-card" key={label}><span>{label}</span><strong className={(value ?? 0) >= 0 ? 'text-up' : 'text-down'}>{formatPercent(value)}</strong></div>)}
        </div>
      </section>

      <section className="coin-detail-section" aria-labelledby="highlights-title">
        <div className="section-heading compact-heading"><div><span className="eyebrow"><Activity size={13} /> Current profile</span><h2 id="highlights-title">Market highlights</h2></div></div>
        <dl className="highlights-grid">
          {highlights.map(([label, value]) => <div className="highlight-card" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </section>

      <section className="coin-detail-section" aria-labelledby="supply-title">
        <div className="section-heading compact-heading"><div><span className="eyebrow"><Layers size={13} /> Token supply</span><h2 id="supply-title">Supply information</h2></div></div>
        <dl className="supply-grid">
          {supply.map(([label, value]) => <div className="supply-card" key={label}><dt>{label}</dt><dd>{value == null ? 'No fixed limit reported' : formatNumber(value)}</dd></div>)}
        </dl>
      </section>

      {(description || homepage) && (
        <section className="coin-about coin-detail-section" aria-labelledby="about-title">
          <div className="section-heading compact-heading"><div><span className="eyebrow">Asset overview</span><h2 id="about-title">About {coin.name}</h2></div></div>
          {description && <p>{description}</p>}
          {homepage && <a className="text-link" href={homepage} target="_blank" rel="noreferrer">Official website <ExternalLink size={14} /></a>}
        </section>
      )}
    </main>
  );
};

export default CoinDetailPage;
