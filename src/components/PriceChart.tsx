import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, BarChart3, Scale } from 'lucide-react';
import { fetchCoinHistory, getApiErrorMessage } from '../services/api';
import { ChartData, CurrencyCode } from '../types/crypto';
import { formatCompactCurrency, formatCurrency } from '../utils/format';
import { DataState } from './DataState';
import '../styles/Chart.css';

interface PriceChartProps {
  coinId: string;
  coinName?: string;
  currency?: CurrencyCode;
}

type ChartPointWithAverage = ChartData & { movingAverage?: number };

const addMovingAverage = (data: ChartData[], period = 20): ChartPointWithAverage[] => data.map((point, index) => {
  if (index < period - 1) return point;
  const window = data.slice(index - period + 1, index + 1);
  return {
    ...point,
    movingAverage: window.reduce((sum, item) => sum + item.price, 0) / window.length,
  };
});

const formatChartTick = (timestamp: number, days: number) => new Intl.DateTimeFormat(undefined, days === 365
  ? { month: 'short', year: '2-digit' }
  : { month: 'short', day: 'numeric' }).format(timestamp);

const PriceChart: React.FC<PriceChartProps> = ({ coinId, coinName, currency = 'usd' }) => {
  const [data, setData] = useState<ChartData[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showVolume, setShowVolume] = useState(true);
  const [showAverage, setShowAverage] = useState(false);
  const [logScale, setLogScale] = useState(false);
  const requestVersion = useRef(0);
  const gradientId = useId().replace(/:/g, '');

  const loadChart = async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    setData([]);
    try {
      const history = await fetchCoinHistory(coinId, days, currency);
      if (requestVersion.current !== version) return;
      setData(history);
    } catch (chartError) {
      if (requestVersion.current !== version) return;
      setData([]);
      setError(getApiErrorMessage(chartError));
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  };

  useEffect(() => {
    void loadChart();
    return () => { requestVersion.current += 1; };
  }, [coinId, currency, days]);

  const chartData = useMemo(() => addMovingAverage(data), [data]);
  const priceRange = useMemo(() => {
    if (data.length === 0) return null;
    const prices = data.map((point) => point.price);
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [data]);

  return (
    <section className="chart-card" aria-labelledby={`chart-title-${gradientId}`}>
      <div className="chart-header">
        <div>
          <span className="eyebrow">Price and volume</span>
          <h2 id={`chart-title-${gradientId}`}>{coinName ?? coinId}</h2>
        </div>
        <div className="time-filters" aria-label="Chart time range">
          {[7, 30, 365].map((value) => (
            <button
              type="button"
              key={value}
              onClick={() => setDays(value)}
              className={days === value ? 'active' : ''}
              aria-pressed={days === value}
            >
              {value === 365 ? '1Y' : `${value}D`}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-controls" aria-label="Chart display options">
        <button type="button" onClick={() => setShowVolume((value) => !value)} aria-pressed={showVolume}>
          <BarChart3 size={14} aria-hidden="true" /> Volume
        </button>
        <button type="button" onClick={() => setShowAverage((value) => !value)} aria-pressed={showAverage}>
          <Activity size={14} aria-hidden="true" /> SMA 20
        </button>
        <button type="button" onClick={() => setLogScale((value) => !value)} aria-pressed={logScale}>
          <Scale size={14} aria-hidden="true" /> Log scale
        </button>
      </div>

      {loading && data.length === 0 ? (
        <div className="chart-loading" aria-label="Loading chart data">
          <div className="skeleton-line" />
          <div className="skeleton-chart" />
        </div>
      ) : error ? (
        <DataState message={error} onRetry={() => void loadChart()} compact />
      ) : data.length === 0 ? (
        <DataState title="No chart history" message="Historical pricing is unavailable for this asset and range." compact />
      ) : (
        <div
          className="chart-wrapper"
          role="img"
          aria-label={`${days === 365 ? 'One year' : `${days} day`} price chart for ${coinName ?? coinId}. Range ${formatCurrency(priceRange?.min, currency)} to ${formatCurrency(priceRange?.max, currency)}.`}
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={80}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 4, bottom: 2, left: 0 }}>
              <defs>
                <linearGradient id={`priceGradient-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00ff88" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#00ff88" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.045)" />
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={(value) => formatChartTick(Number(value), days)}
                tick={{ fontSize: 10, fill: '#858bab', fontFamily: 'JetBrains Mono' }}
                axisLine={false}
                tickLine={false}
                minTickGap={32}
                tickCount={5}
              />
              <YAxis
                yAxisId="price"
                domain={['auto', 'auto']}
                scale={logScale ? 'log' : 'auto'}
                tickFormatter={(value) => formatCompactCurrency(value, currency)}
                tick={{ fontSize: 10, fill: '#858bab', fontFamily: 'JetBrains Mono' }}
                axisLine={false}
                tickLine={false}
                width={64}
              />
              <YAxis yAxisId="volume" orientation="right" hide domain={[0, 'auto']} />
              <Tooltip
                labelFormatter={(label) => new Date(Number(label)).toLocaleString()}
                formatter={(value, name) => [
                  name === 'volume' ? formatCompactCurrency(Number(value), currency) : formatCurrency(Number(value), currency),
                  name === 'movingAverage' ? 'SMA 20' : name === 'volume' ? 'Volume' : 'Price',
                ]}
                contentStyle={{
                  backgroundColor: '#0c0c1d',
                  border: '1px solid rgba(0, 255, 136, 0.2)',
                  borderRadius: '10px',
                  color: '#f4f5fb',
                  fontFamily: 'JetBrains Mono',
                  fontSize: '0.78rem',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}
                cursor={{ stroke: 'rgba(0, 255, 136, 0.25)', strokeWidth: 1 }}
              />
              {showVolume && (
                <Bar yAxisId="volume" dataKey="volume" fill="rgba(93, 111, 255, 0.18)" maxBarSize={8} />
              )}
              <Area
                yAxisId="price"
                type="monotone"
                dataKey="price"
                stroke="#00ff88"
                strokeWidth={2}
                fill={`url(#priceGradient-${gradientId})`}
                dot={false}
                isAnimationActive={false}
              />
              {showAverage && (
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="movingAverage"
                  stroke="#a855f7"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
};

export default PriceChart;
