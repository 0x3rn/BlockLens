import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { GitCompareArrows, Plus, X } from 'lucide-react';
import { DataState } from '../components/DataState';
import { useMarket } from '../context/MarketContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { fetchCoinHistory, getApiErrorMessage } from '../services/api';
import { ChartData } from '../types/crypto';
import { formatCompactCurrency, formatCurrency, formatDate, formatPercent } from '../utils/format';
import '../styles/Chart.css';

const chartColors = ['#00ff88', '#a855f7', '#5d6fff', '#ffaa00'];
const formatChartTick = (timestamp: number, days: number) => new Intl.DateTimeFormat(undefined, days === 365
  ? { month: 'short', year: '2-digit' }
  : { month: 'short', day: 'numeric' }).format(timestamp);

const ComparePage: React.FC = () => {
  const { coins, currency } = useMarket();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [candidate, setCandidate] = useState('');
  const [days, setDays] = useState(30);
  const [histories, setHistories] = useState<Record<string, ChartData[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  usePageMeta('Compare Assets', 'Compare normalized crypto performance, market capitalization, volume, and volatility across multiple assets.');

  useEffect(() => {
    if (selectedIds.length === 0 && coins.length > 0) {
      setSelectedIds(coins.slice(0, 2).map((coin) => coin.id));
    }
  }, [coins, selectedIds.length]);

  useEffect(() => {
    if (selectedIds.length === 0) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    Promise.all(selectedIds.map(async (id) => [id, await fetchCoinHistory(id, days, currency)] as const))
      .then((entries) => {
        if (requestVersion.current === version) setHistories(Object.fromEntries(entries));
      })
      .catch((loadError) => {
        if (requestVersion.current === version) setError(getApiErrorMessage(loadError));
      })
      .finally(() => {
        if (requestVersion.current === version) setLoading(false);
      });
    return () => { requestVersion.current += 1; };
  }, [currency, days, selectedIds]);

  const selectedCoins = selectedIds.map((id) => coins.find((coin) => coin.id === id)).filter(Boolean);
  const availableCoins = coins.filter((coin) => !selectedIds.includes(coin.id));

  const normalizedData = useMemo(() => {
    const reference = histories[selectedIds[0]] ?? [];
    return reference.map((point, index) => {
      const row: Record<string, number> = { timestamp: point.timestamp };
      selectedIds.forEach((id) => {
        const series = histories[id] ?? [];
        if (series.length === 0) return;
        const targetIndex = reference.length <= 1
          ? 0
          : Math.round((index / (reference.length - 1)) * (series.length - 1));
        const firstPrice = series[0]?.price;
        const currentPrice = series[targetIndex]?.price;
        if (firstPrice > 0 && currentPrice != null) row[id] = (currentPrice / firstPrice) * 100;
      });
      return row;
    });
  }, [histories, selectedIds]);

  const addCoin = () => {
    if (!candidate || selectedIds.length >= 4) return;
    setSelectedIds((previous) => [...previous, candidate]);
    setCandidate('');
  };

  return (
    <main className="app-container page-stack">
      <header className="markets-header page-header-card">
        <div className="markets-title-wrap">
          <span className="markets-icon compare-icon"><GitCompareArrows size={25} aria-hidden="true" /></span>
          <div><span className="eyebrow">Relative performance</span><h1>Compare Assets</h1><p>Normalize assets to 100 and compare the shape of their performance, not just nominal prices.</p></div>
        </div>
        <div className="compare-add-control">
          <select value={candidate} onChange={(event) => setCandidate(event.target.value)} disabled={selectedIds.length >= 4} aria-label="Asset to add">
            <option value="">Add an asset</option>
            {availableCoins.map((coin) => <option value={coin.id} key={coin.id}>{coin.name} ({coin.symbol.toUpperCase()})</option>)}
          </select>
          <button type="button" className="secondary-button" onClick={addCoin} disabled={!candidate || selectedIds.length >= 4}><Plus size={15} /> Add</button>
        </div>
      </header>

      <div className="compare-selection" aria-label="Selected assets">
        {selectedCoins.map((coin, index) => coin && (
          <span className="compare-chip" style={{ '--coin-color': chartColors[index] } as React.CSSProperties} key={coin.id}>
            <span className="compare-series-dot" aria-hidden="true" />
            <img src={coin.image} alt="" /> {coin.name}
            <button type="button" onClick={() => setSelectedIds((ids) => ids.filter((id) => id !== coin.id))} aria-label={`Remove ${coin.name}`} disabled={selectedIds.length === 1}><X size={13} /></button>
          </span>
        ))}
      </div>

      <section className="compare-chart-card" aria-labelledby="comparison-chart-title">
        <div className="chart-header">
          <div><span className="eyebrow">Indexed performance</span><h2 id="comparison-chart-title">Growth of 100</h2></div>
          <div className="time-filters" aria-label="Comparison time range">
            {[7, 30, 365].map((value) => <button type="button" key={value} onClick={() => setDays(value)} className={days === value ? 'active' : ''} aria-pressed={days === value}>
              {value === 365 ? '1Y' : `${value}D`}
            </button>)}
          </div>
        </div>
        {error ? <DataState message={error} compact /> : loading && normalizedData.length === 0 ? <div className="skeleton-chart compare-skeleton" /> : (
          <div className="compare-chart" role="img" aria-label={`Normalized ${days === 365 ? 'one year' : `${days} day`} performance comparison for ${selectedCoins.map((coin) => coin?.name).join(', ')}`}>
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={0}
              initialDimension={{ width: 320, height: 340 }}
              debounce={80}
            >
              <LineChart data={normalizedData} margin={{ top: 12, right: 6, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.045)" />
                <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(value) => formatChartTick(Number(value), days)} tick={{ fontSize: 10, fill: '#858bab' }} axisLine={false} tickLine={false} minTickGap={32} tickCount={5} />
                <YAxis tickFormatter={(value) => `${Number(value).toFixed(0)}`} tick={{ fontSize: 10, fill: '#858bab' }} axisLine={false} tickLine={false} width={38} />
                <Tooltip labelFormatter={(label) => formatDate(Number(label))} formatter={(value, name) => [`${Number(value).toFixed(2)}`, coins.find((coin) => coin.id === name)?.name ?? name]} contentStyle={{ background: '#0c0c1d', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8 }} />
                <Legend formatter={(id) => coins.find((coin) => coin.id === id)?.name ?? id} wrapperStyle={{ fontSize: '0.68rem', color: '#a7acc8', paddingTop: '8px' }} />
                {selectedIds.map((id, index) => <Line key={id} type="monotone" dataKey={id} stroke={chartColors[index]} strokeWidth={2} dot={false} isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="comparison-table-card" aria-labelledby="comparison-table-title">
        <div className="section-heading compact-heading"><div><span className="eyebrow">Side by side</span><h2 id="comparison-table-title">Market profile</h2></div></div>
        <div className="comparison-table-scroll">
          <table>
            <caption className="sr-only">Current metrics for compared assets</caption>
            <thead><tr><th>Asset</th><th>Price</th><th>24h</th><th>7d</th><th>30d</th><th>Market cap</th><th>24h volume</th></tr></thead>
            <tbody>{selectedCoins.map((coin) => coin && <tr key={coin.id}><td><span className="comparison-asset"><img src={coin.image} alt="" /><strong>{coin.name}</strong><small>{coin.symbol.toUpperCase()}</small></span></td><td>{formatCurrency(coin.current_price, currency)}</td><td className={(coin.price_change_percentage_24h ?? 0) >= 0 ? 'text-up' : 'text-down'}>{formatPercent(coin.price_change_percentage_24h)}</td><td className={(coin.price_change_percentage_7d_in_currency ?? 0) >= 0 ? 'text-up' : 'text-down'}>{formatPercent(coin.price_change_percentage_7d_in_currency)}</td><td className={(coin.price_change_percentage_30d_in_currency ?? 0) >= 0 ? 'text-up' : 'text-down'}>{formatPercent(coin.price_change_percentage_30d_in_currency)}</td><td>{formatCompactCurrency(coin.market_cap, currency)}</td><td>{formatCompactCurrency(coin.total_volume, currency)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
};

export default ComparePage;
