import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CandleData, CurrencyCode } from '../types/crypto';
import { formatCompactCurrency, formatCurrency, formatPriceAxis } from '../utils/format';

interface CandlestickChartProps {
  data: CandleData[];
  currency: CurrencyCode;
  interval: string;
  coinName: string;
  showVolume: boolean;
  showAverage: boolean;
  logScale: boolean;
}

const HEIGHT = 360;
const RIGHT = 18;
const TOP = 14;
const PRICE_BOTTOM = 278;
const VOLUME_BOTTOM = 338;
const VOLUME_TOP = 294;

const CandlestickChart: React.FC<CandlestickChartProps> = ({
  data,
  currency,
  interval,
  coinName,
  showVolume,
  showAverage,
  logScale,
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(720);
  const [zoom, setZoom] = useState(1);
  const left = chartWidth < 520 ? 54 : 66;

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return undefined;
    const updateWidth = () => setChartWidth(Math.max(320, Math.round(element.clientWidth)));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => setZoom(1), [data, interval]);

  const visibleData = useMemo(() => {
    if (zoom <= 1) return data;
    const visibleCount = Math.max(16, Math.round(data.length / zoom));
    return data.slice(-visibleCount);
  }, [data, zoom]);

  const plotWidth = chartWidth - left - RIGHT;
  const prices = visibleData.flatMap((candle) => [candle.high, candle.low]).filter(Number.isFinite);
  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);
  const safeMin = rawMin > 0 ? rawMin : 0.00000001;
  const safeMax = rawMax > safeMin ? rawMax : safeMin * 1.01;
  const valueMin = logScale ? Math.log(safeMin) : safeMin;
  const valueMax = logScale ? Math.log(safeMax) : safeMax;
  const pad = Math.max((valueMax - valueMin) * 0.06, 0.000001);
  const min = valueMin - pad;
  const max = valueMax + pad;
  const volumeMax = Math.max(...visibleData.map((candle) => candle.volume), 1);
  const step = plotWidth / Math.max(visibleData.length, 1);
  const bodyWidth = Math.max(2, Math.min(10, step * 0.62));

  const y = (value: number) => {
    const transformed = logScale ? Math.log(Math.max(value, 0.00000001)) : value;
    return TOP + ((max - transformed) / Math.max(max - min, 0.000001)) * (PRICE_BOTTOM - TOP);
  };

  const averagePath = useMemo(() => {
    if (!showAverage) return '';
    return visibleData.map((candle, index) => {
      const start = Math.max(0, index - 19);
      const average = visibleData.slice(start, index + 1).reduce((sum, item) => sum + item.close, 0) / (index - start + 1);
      const x = left + (index + 0.5) * step;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y(average).toFixed(2)}`;
    }).join(' ');
  }, [visibleData, showAverage, step, left, min, max, logScale]);

  const gridValues = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const transformed = max - ratio * (max - min);
    return logScale ? Math.exp(transformed) : transformed;
  });
  const tickIndexes = [0, Math.floor((visibleData.length - 1) * 0.33), Math.floor((visibleData.length - 1) * 0.66), Math.max(0, visibleData.length - 1)];
  const zoomIn = () => setZoom((value) => Math.min(6, value + 1));
  const zoomOut = () => setZoom((value) => Math.max(1, value - 1));
  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.deltaY < 0) zoomIn();
    if (event.deltaY > 0) zoomOut();
  };

  return (
    <div
      ref={chartRef}
      className="candle-chart"
      role="img"
      aria-label={`${interval} candlestick chart for ${coinName}. ${visibleData.length} visible candles.`}
      onWheel={handleWheel}
    >
      <div className="candle-chart-toolbar" aria-label="Candle chart zoom controls">
        <span>ZOOM {zoom}X</span>
        <button type="button" onClick={zoomOut} disabled={zoom === 1} aria-label="Zoom out">−</button>
        <button type="button" onClick={zoomIn} disabled={zoom === 6} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1}>Reset</button>
      </div>
      <svg viewBox={`0 0 ${chartWidth} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <g className="candle-grid">
          {gridValues.map((value, index) => {
            const lineY = TOP + (index / 3) * (PRICE_BOTTOM - TOP);
            return (
              <g key={`grid-${index}`}>
                <line x1={left} x2={chartWidth - RIGHT} y1={lineY} y2={lineY} />
                <text x={left - 10} y={lineY + 4} textAnchor="end">{formatPriceAxis(value, currency)}</text>
              </g>
            );
          })}
        </g>

        {showVolume && visibleData.map((candle, index) => {
          const x = left + (index + 0.5) * step;
          const barHeight = (candle.volume / volumeMax) * (VOLUME_BOTTOM - VOLUME_TOP);
          const up = candle.close >= candle.open;
          return <rect className={`candle-volume ${up ? 'up' : 'down'}`} key={`volume-${candle.timestamp}`} x={x - bodyWidth / 2} y={VOLUME_BOTTOM - barHeight} width={bodyWidth} height={barHeight} />;
        })}

        {visibleData.map((candle, index) => {
          const x = left + (index + 0.5) * step;
          const openY = y(candle.open);
          const closeY = y(candle.close);
          const up = candle.close >= candle.open;
          const top = Math.min(openY, closeY);
          const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
          return (
            <g className={`candle ${up ? 'up' : 'down'}`} key={`candle-${candle.timestamp}`}>
              <title>{`${new Date(candle.timestamp).toLocaleString()} · O ${formatCurrency(candle.open, currency)} · H ${formatCurrency(candle.high, currency)} · L ${formatCurrency(candle.low, currency)} · C ${formatCurrency(candle.close, currency)}`}</title>
              <line className="candle-wick" x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} />
              <rect className="candle-body" x={x - bodyWidth / 2} y={top} width={bodyWidth} height={bodyHeight} rx="1" />
            </g>
          );
        })}

        {showAverage && <path className="candle-average" d={averagePath} />}

        {tickIndexes.map((index, tickIndex) => {
          const candle = visibleData[index];
          if (!candle) return null;
          const x = left + (index + 0.5) * step;
          return <text className="candle-time" key={`tick-${tickIndex}`} x={x} y={HEIGHT - 8} textAnchor={tickIndex === 0 ? 'start' : tickIndex === tickIndexes.length - 1 ? 'end' : 'middle'}>{new Date(candle.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</text>;
        })}
      </svg>
    </div>
  );
};

export default CandlestickChart;
