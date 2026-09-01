import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search, Star } from 'lucide-react';
import { useMarket } from '../context/MarketContext';
import { useToast } from '../context/ToastContext';
import { Coin } from '../types/crypto';
import { formatCompactCurrency, formatCurrency, formatPercent } from '../utils/format';
import '../styles/Table.css';

type SortKey = 'market_cap_rank' | 'name' | 'current_price' | 'price_change_percentage_24h' | 'market_cap' | 'total_volume';
type FilterKey = 'all' | 'gainers' | 'losers' | 'stablecoins' | 'watchlist';

interface CoinTableProps {
  coins: Coin[];
  compact?: boolean;
  pageSize?: number;
  title?: string;
}

const stablecoinSymbols = new Set([
  'usdt', 'usdc', 'dai', 'usds', 'usde', 'usdg', 'pyusd', 'fdusd', 'tusd', 'usdd', 'rlusd', 'usd1',
]);

const CoinTable: React.FC<CoinTableProps> = ({
  coins,
  compact = false,
  pageSize = compact ? 10 : 20,
  title = 'Cryptocurrency markets',
}) => {
  const { currency, watchlist, toggleWatchlist } = useMarket();
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({
    key: 'market_cap_rank',
    direction: 'asc',
  });

  useEffect(() => setPage(1), [filter, query, sort]);

  const filteredCoins = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const visible = coins.filter((coin) => {
      const matchesQuery = !normalizedQuery
        || coin.name.toLowerCase().includes(normalizedQuery)
        || coin.symbol.toLowerCase().includes(normalizedQuery);
      if (!matchesQuery) return false;
      if (filter === 'gainers') return (coin.price_change_percentage_24h ?? 0) > 0;
      if (filter === 'losers') return (coin.price_change_percentage_24h ?? 0) < 0;
      if (filter === 'stablecoins') return stablecoinSymbols.has(coin.symbol.toLowerCase());
      if (filter === 'watchlist') return watchlist.includes(coin.id);
      return true;
    });

    return visible.sort((a, b) => {
      const aValue = a[sort.key];
      const bValue = b[sort.key];
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      const comparison = typeof aValue === 'string'
        ? aValue.localeCompare(String(bValue))
        : Number(aValue) - Number(bValue);
      return sort.direction === 'asc' ? comparison : -comparison;
    });
  }, [coins, filter, query, sort, watchlist]);

  const totalPages = Math.max(1, Math.ceil(filteredCoins.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleCoins = compact
    ? filteredCoins.slice(0, pageSize)
    : filteredCoins.slice((safePage - 1) * pageSize, safePage * pageSize);

  const requestSort = (key: SortKey) => {
    setSort((previous) => ({
      key,
      direction: previous.key === key && previous.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' => (
    sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
  );

  const SortHeader: React.FC<{ column: SortKey; label: string; className?: string }> = ({ column, label, className }) => (
    <th className={className} aria-sort={ariaSort(column)}>
      <button type="button" className="sort-button" onClick={() => requestSort(column)}>
        <span>{label}</span>
        {sort.key === column && (
          sort.direction === 'asc'
            ? <ChevronUp size={13} aria-hidden="true" />
            : <ChevronDown size={13} aria-hidden="true" />
        )}
      </button>
    </th>
  );

  return (
    <section className="table-section" aria-labelledby={compact ? undefined : 'markets-table-title'}>
      {!compact && (
        <div className="market-toolbar">
          <div>
            <h2 id="markets-table-title">{title}</h2>
            <p>
              {filteredCoins.length} {filteredCoins.length === 1 ? 'asset matches' : 'assets match'} this view
            </p>
          </div>
          <label className="market-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search by coin name or symbol</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or symbol"
            />
          </label>
          <div className="filter-chips" aria-label="Market filters">
            {([
              ['all', 'All'],
              ['gainers', 'Gainers'],
              ['losers', 'Losers'],
              ['stablecoins', 'Stablecoins'],
              ['watchlist', 'Watchlist'],
            ] as [FilterKey, string][]).map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={filter === value ? 'active' : ''}
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="table-container">
        <div className="table-scroll">
          <table>
            <caption className="sr-only">{title}, sortable by asset, price, change, market cap, and volume</caption>
            <thead>
              <tr>
                <th className="col-watch"><span className="sr-only">Watchlist</span></th>
                <SortHeader column="name" label="Asset" className="col-asset" />
                <SortHeader column="current_price" label="Price" className="col-price" />
                <SortHeader column="price_change_percentage_24h" label="24h" className="col-change" />
                <th className="col-change col-7d">7d</th>
                <SortHeader column="market_cap" label="Market Cap" className="col-mcap-desk" />
                <SortHeader column="total_volume" label="Volume (24h)" className="col-volume" />
              </tr>
            </thead>
            <tbody>
              {visibleCoins.map((coin) => {
                const isWatched = watchlist.includes(coin.id);
                const dayChange = coin.price_change_percentage_24h;
                const weekChange = coin.price_change_percentage_7d_in_currency;
                return (
                  <tr key={coin.id}>
                    <td className="col-watch">
                      <button
                        type="button"
                        className={`watch-button ${isWatched ? 'star-active' : 'star-inactive'}`}
                        onClick={() => {
                          toggleWatchlist(coin.id);
                          showToast(`${coin.name} ${isWatched ? 'removed from' : 'added to'} your watchlist.`, isWatched ? 'info' : 'success');
                        }}
                        aria-label={`${isWatched ? 'Remove' : 'Add'} ${coin.name} ${isWatched ? 'from' : 'to'} watchlist`}
                        aria-pressed={isWatched}
                      >
                        <Star size={17} aria-hidden="true" />
                      </button>
                    </td>
                    <td className="col-asset">
                      <Link className="asset-cell" to={`/coin/${coin.id}`}>
                        <img src={coin.image} alt="" className="coin-icon" loading="lazy" />
                        <span className="asset-text">
                          <span className="asset-name">{coin.name}</span>
                          <span className="asset-symbol">{coin.symbol.toUpperCase()} · #{coin.market_cap_rank}</span>
                          <span className="asset-mcap-mobile">{formatCompactCurrency(coin.market_cap, currency)} cap</span>
                        </span>
                      </Link>
                    </td>
                    <td className="col-price">{formatCurrency(coin.current_price, currency)}</td>
                    <td className={`col-change ${(dayChange ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                      {formatPercent(dayChange)}
                    </td>
                    <td className={`col-change col-7d ${(weekChange ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>
                      {formatPercent(weekChange)}
                    </td>
                    <td className="col-mcap-desk">{formatCompactCurrency(coin.market_cap, currency)}</td>
                    <td className="col-volume">{formatCompactCurrency(coin.total_volume, currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visibleCoins.length === 0 && (
            <div className="table-empty">
              <h3>No assets found</h3>
              <p>Try a different search or filter.</p>
            </div>
          )}
        </div>
      </div>

      {!compact && totalPages > 1 && (
        <nav className="table-pagination" aria-label="Market table pages">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={safePage === 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span>Page {safePage} of {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={safePage === totalPages}
            aria-label="Next page"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      )}
    </section>
  );
};

export default CoinTable;
