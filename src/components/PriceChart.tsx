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
import { fetchCoinCandles, fetchCoinHistory, getApiErrorMessage } from '../services/api';
import { CandleData, CandleInterval, ChartData, CurrencyCode } from '../types/crypto';
import { formatCompactCurrency, formatCurrency, formatPriceAxis } from '../utils/format';
import CandlestickChart from './CandlestickChart';
import { DataState } from './DataState';
import '../styles/Chart.css';

interface PriceChartProps {
  coinId: string;
  coinName?: string;
  currency?: CurrencyCode;
}

type ChartPointWithAverage = ChartData & { movingAverage?: number };
const intradayIntervals: CandleInterval[] = ['5m', '15m', '30m', '1h', '4h', '12h', '24h'];

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
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [range, setRange] = useState<number | CandleInterval>(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showVolume, setShowVolume] = useState(true);
  const [showAverage, setShowAverage] = useState(false);
  const [logScale, setLogScale] = useState(false);
  const [loadedRange, setLoadedRange] = useState<number | CandleInterval | null>(null);
  const requestVersion = useRef(0);
  const gradientId = useId().replace(/:/g, '');
  const renderedRange = loadedRange ?? range;
  const renderedIsIntraday = typeof renderedRange === 'string';
  const days = typeof renderedRange === 'number' ? renderedRange : 7;

  const loadChart = async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      if (typeof range === 'string') {
        const history = await fetchCoinCandles(coinId, range, currency);
        if (requestVersion.current !== version) return;
        setCandles(history);
        setLoadedRange(range);
      } else {
        const history = await fetchCoinHistory(coinId, range, currency);
        if (requestVersion.current !== version) return;
        setData(history);
        setLoadedRange(range);
      }
    } catch (chartError) {
      if (requestVersion.current !== version) return;
      setError(getApiErrorMessage(chartError));
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  };

  useEffect(() => {
    void loadChart();
    return () => { requestVersion.current += 1; };
  }, [coinId, currency, range]);

  useEffect(() => {
    setLoadedRange(null);
    setData([]);
    setCandles([]);
  }, [coinId, currency]);

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
        <div className="chart-range-groups">
          <div className="chart-range-group">
            <span className="chart-range-label">Candles</span>
            <div className="time-filters" aria-label="Intraday candle interval">
              {intradayIntervals.map((interval) => (
                <button type="button" key={interval} onClick={() => setRange(interval)} className={range === interval ? 'active' : ''} aria-pressed={range === interval}>
                  {interval}
                </button>
              ))}
            </div>
          </div>
          <div className="chart-range-group">
            <span className="chart-range-label">History</span>
            <div className="time-filters" aria-label="Chart time range">
              {[7, 30, 365].map((value) => (
                <button type="button" key={value} onClick={() => setRange(value)} className={range === value ? 'active' : ''} aria-pressed={range === value}>
                  {value === 365 ? '1Y' : `${value}D`}
                </button>
              ))}
            </div>
          </div>
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

      {loading && loadedRange === null ? (
        <div className="chart-loading" aria-label="Loading chart data">
          <div className="skeleton-line" />
          <div className="skeleton-chart" />
        </div>
      ) : (
        <>
          {error && <DataState message={error} onRetry={loadChart} compact />}
          {!error && renderedIsIntraday && candles.length === 0 ? (
            <DataState title="No intraday candles" message="Intraday candle data is unavailable for this asset and interval." onRetry={loadChart} compact />
          ) : !error && !renderedIsIntraday && data.length === 0 ? (
            <DataState title="No chart history" message="Historical pricing is unavailable for this asset and range." onRetry={loadChart} compact />
          ) : renderedIsIntraday ? (
            <CandlestickChart data={candles} currency={currency} interval={renderedRange as CandleInterval} coinName={coinName ?? coinId} showVolume={showVolume} showAverage={showAverage} logScale={logScale} />
          ) : (
        <div
          className="chart-wrapper"
          role="img"
          aria-label={`${days === 365 ? 'One year' : `${days} day`} price chart for ${coinName ?? coinId}. Range ${formatCurrency(priceRange?.min, currency)} to ${formatCurrency(priceRange?.max, currency)}.`}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={0}
            minHeight={0}
            initialDimension={{ width: 320, height: 290 }}
            debounce={80}
          >
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
                tickFormatter={(value) => formatPriceAxis(value, currency)}
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
        </>
      )}
    </section>
  );
};

export default PriceChart;
