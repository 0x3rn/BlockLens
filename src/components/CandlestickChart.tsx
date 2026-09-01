import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CandleData, CurrencyCode } from '../types/crypto';
import { formatCurrency, formatPriceAxis } from '../utils/format';

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
const TOP = 48;
const PRICE_BOTTOM = 268;
const VOLUME_TOP = 291;
const VOLUME_BOTTOM = 337;
// Match the current 30m candle proportions across every interval and zoom level.
const CANDLE_BODY_WIDTH = 10;
const STANDARD_CANDLE_COUNT = 24;

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
  const [fullRange, setFullRange] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const left = chartWidth < 520 ? 64 : 76;

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return undefined;
    const updateWidth = () => setChartWidth(Math.max(320, Math.round(element.clientWidth)));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setZoom(1);
    setFullRange(false);
    setHoveredIndex(null);
  }, [data, interval]);

  const visibleData = useMemo(() => {
    // Every interval defaults to 24 candles. The interval itself determines the
    // span: 5m covers two hours, 1h covers one day, 4h covers four days,
    // 12h covers twelve days, and 24h covers twenty-four days.
    if (fullRange || data.length <= STANDARD_CANDLE_COUNT) return data;
    const visibleCount = Math.max(6, Math.round(STANDARD_CANDLE_COUNT / zoom));
    return data.slice(-Math.min(data.length, visibleCount));
  }, [data, fullRange, zoom]);

  const plotWidth = Math.max(1, chartWidth - left - RIGHT);
  const prices = visibleData.flatMap((candle) => [candle.high, candle.low]).filter(Number.isFinite);
  const rawMin = prices.length ? Math.min(...prices) : 0;
  const rawMax = prices.length ? Math.max(...prices) : 1;
  const safeMin = rawMin > 0 ? rawMin : 0.00000001;
  const safeMax = rawMax > safeMin ? rawMax : safeMin * 1.01;
  const valueMin = logScale ? Math.log(safeMin) : safeMin;
  const valueMax = logScale ? Math.log(safeMax) : safeMax;
  const pad = Math.max((valueMax - valueMin) * 0.08, 0.000001);
  const min = valueMin - pad;
  const max = valueMax + pad;
  const volumeMax = Math.max(...visibleData.map((candle) => candle.volume), 1);
  const step = plotWidth / Math.max(visibleData.length, 1);
  const bodyWidth = CANDLE_BODY_WIDTH;

  const y = (value: number) => {
    const transformed = logScale ? Math.log(Math.max(value, 0.00000001)) : value;
    return TOP + ((max - transformed) / Math.max(max - min, 0.000001)) * (PRICE_BOTTOM - TOP);
  };

  const averagePath = useMemo(() => {
    if (!showAverage || !visibleData.length) return '';
    return visibleData.map((candle, index) => {
      const start = Math.max(0, index - 19);
      const average = visibleData.slice(start, index + 1).reduce((sum, item) => sum + item.close, 0) / (index - start + 1);
      const x = left + (index + 0.5) * step;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y(average).toFixed(2)}`;
    }).join(' ');
  }, [visibleData, showAverage, step, left, min, max, logScale]);

  const gridValues = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const transformed = max - ratio * (max - min);
    return logScale ? Math.exp(transformed) : transformed;
  });
  const tickIndexes = [0, Math.floor((visibleData.length - 1) * 0.33), Math.floor((visibleData.length - 1) * 0.66), Math.max(0, visibleData.length - 1)];
  const lastIndex = Math.max(0, visibleData.length - 1);
  const selectedIndex = hoveredIndex === null ? lastIndex : Math.min(lastIndex, hoveredIndex);
  const selectedCandle = visibleData[selectedIndex];
  const selectedX = left + (selectedIndex + 0.5) * step;
  const lastPriceY = selectedCandle ? y(selectedCandle.close) : PRICE_BOTTOM;
  const priceTagY = Math.max(TOP + 2, Math.min(PRICE_BOTTOM - 12, lastPriceY - 9));

  const zoomIn = () => {
    setFullRange(false);
    setZoom((value) => Math.min(6, value + 1));
  };
  const zoomOut = () => {
    setFullRange(false);
    setZoom((value) => Math.max(1, value - 1));
  };
  const resetView = () => {
    setFullRange(false);
    setZoom(1);
  };
  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.deltaY < 0) zoomIn();
    if (event.deltaY > 0) zoomOut();
  };
  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!visibleData.length) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * chartWidth;
    const index = Math.round((svgX - left) / step - 0.5);
    setHoveredIndex(Math.max(0, Math.min(lastIndex, index)));
  };

  return (
    <div
      ref={chartRef}
      className="candle-chart"
      role="img"
      aria-label={`${interval} candlestick chart for ${coinName}. ${visibleData.length} visible candles.`}
      onWheel={handleWheel}
    >
      <div className="candle-readout" aria-live="polite">
        <span className="candle-readout-title">{interval} · {selectedCandle ? new Date(selectedCandle.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
        {selectedCandle && (
          <span className="candle-readout-values">
            <b>O</b> {formatCurrency(selectedCandle.open, currency)}
            <b>H</b> {formatCurrency(selectedCandle.high, currency)}
            <b>L</b> {formatCurrency(selectedCandle.low, currency)}
            <b>C</b> <em className={selectedCandle.close >= selectedCandle.open ? 'up' : 'down'}>{formatCurrency(selectedCandle.close, currency)}</em>
          </span>
        )}
      </div>
      <div className="candle-chart-toolbar" aria-label="Candle chart zoom controls">
        <span>{fullRange ? `ALL · ${data.length}` : `VIEW · ${visibleData.length}`}</span>
        <button type="button" onClick={zoomOut} disabled={fullRange || zoom === 1} aria-label="Zoom out">−</button>
        <button type="button" onClick={zoomIn} disabled={zoom === 6} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => setFullRange(true)} disabled={fullRange}>All</button>
        <button type="button" onClick={resetView} disabled={!fullRange && zoom === 1}>Reset</button>
      </div>
      <svg
        viewBox={`0 0 ${chartWidth} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoveredIndex(null)}
      >
        <g className="candle-grid">
          {gridValues.map((value, index) => {
            const lineY = TOP + (index / 4) * (PRICE_BOTTOM - TOP);
            return (
              <g key={`grid-${index}`}>
                <line x1={left} x2={chartWidth - RIGHT} y1={lineY} y2={lineY} />
                <text x={left - 10} y={lineY + 4} textAnchor="end">{formatPriceAxis(value, currency)}</text>
              </g>
            );
          })}
          <line className="candle-volume-divider" x1={left} x2={chartWidth - RIGHT} y1={VOLUME_TOP - 8} y2={VOLUME_TOP - 8} />
          <text className="candle-pane-label" x={left} y={VOLUME_TOP - 15}>VOL</text>
        </g>

        {showVolume && visibleData.map((candle, index) => {
          const x = left + (index + 0.5) * step;
          const barHeight = (candle.volume / volumeMax) * (VOLUME_BOTTOM - VOLUME_TOP);
          const up = candle.close >= candle.open;
          return <rect className={`candle-volume ${up ? 'up' : 'down'}`} key={`volume-${candle.timestamp}`} x={x - bodyWidth / 2} y={VOLUME_BOTTOM - barHeight} width={bodyWidth} height={Math.max(1, barHeight)} />;
        })}

        {visibleData.map((candle, index) => {
          const x = left + (index + 0.5) * step;
          const openY = y(candle.open);
          const closeY = y(candle.close);
          const up = candle.close >= candle.open;
          const top = Math.min(openY, closeY);
          const bodyHeight = Math.max(4, Math.abs(closeY - openY));
          return (
            <g className={`candle ${up ? 'up' : 'down'}`} key={`candle-${candle.timestamp}`}>
              <title>{`${new Date(candle.timestamp).toLocaleString()} · O ${formatCurrency(candle.open, currency)} · H ${formatCurrency(candle.high, currency)} · L ${formatCurrency(candle.low, currency)} · C ${formatCurrency(candle.close, currency)}`}</title>
              <line className="candle-wick" x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} />
              <rect className="candle-body" x={x - bodyWidth / 2} y={top} width={bodyWidth} height={bodyHeight} />
            </g>
          );
        })}

        {showAverage && <path className="candle-average" d={averagePath} />}
        {selectedCandle && <>
          <line className="candle-crosshair-x" x1={selectedX} x2={selectedX} y1={TOP} y2={VOLUME_BOTTOM} />
          <line className="candle-last-price" x1={left} x2={chartWidth - RIGHT} y1={lastPriceY} y2={lastPriceY} />
          <g className="candle-price-tag">
            <rect x={chartWidth - RIGHT - 64} y={priceTagY} width="64" height="18" rx="3" />
            <text x={chartWidth - RIGHT - 7} y={priceTagY + 12} textAnchor="end">{formatPriceAxis(selectedCandle.close, currency)}</text>
          </g>
        </>}

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
