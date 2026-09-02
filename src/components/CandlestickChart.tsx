import React, { useEffect, useRef, useState } from 'react';
import {
  CandlestickData,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramData,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  LineSeries,
  LineStyle,
  MouseEventParams,
  PriceScaleMode,
  Time,
  createChart,
} from 'lightweight-charts';
import { CandleData, CandleInterval, CurrencyCode } from '../types/crypto';
import { formatCurrency, formatPriceAxis } from '../utils/format';

interface CandlestickChartProps {
  data: CandleData[];
  currency: CurrencyCode;
  interval: CandleInterval;
  coinSymbol?: string;
  coinName: string;
  showVolume: boolean;
  showAverage: boolean;
  logScale: boolean;
}

const DESKTOP_CANDLE_COUNT = 48;
const MOBILE_CANDLE_COUNT = 36;
const CHART_HEIGHT = 360;
const BAR_SPACING = 10;
const PRICE_SCALE_WIDTH = 68;
const candleIntervalMs: Record<CandleInterval, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
};
const UP_COLOR = '#00e58b';
const DOWN_COLOR = '#ff5b76';
const MUTED_TEXT = '#858bab';
const CHART_BG = '#0a0b18';

const getCandleTime = (timestamp: number) => Math.floor(timestamp / 1000) as unknown as Time;

const getTimeMilliseconds = (time: Time) => {
  if (typeof time === 'number') return time * 1000;
  if (typeof time === 'string') return new Date(time).getTime();
  return Date.UTC(time.year, time.month - 1, time.day);
};

const formatAxisPrice = (price: number) => {
  const absolute = Math.abs(price);
  if (absolute >= 1_000_000_000) return `${(price / 1_000_000_000).toFixed(1)}B`;
  if (absolute >= 1_000_000) return `${(price / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(price / 1_000).toFixed(absolute >= 10_000 ? 0 : 1)}k`;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(price);
};

const formatCountdown = (milliseconds: number) => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
};

const formatTime = (timestamp: number, showDate: boolean) => new Intl.DateTimeFormat(undefined, showDate
  ? { month: 'short', day: 'numeric' }
  : { hour: '2-digit', minute: '2-digit' }).format(timestamp);

const CandlestickChart: React.FC<CandlestickChartProps> = ({
  data,
  currency,
  interval,
  coinSymbol,
  coinName,
  showVolume,
  showAverage,
  logScale,
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const averageSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const candleDataRef = useRef<CandleData[]>(data);
  const candleLookupRef = useRef(new Map<number, CandleData>());
  const [chartWidth, setChartWidth] = useState(720);
  const [zoom, setZoom] = useState(1);
  const [fullRange, setFullRange] = useState(false);
  const [selectedCandle, setSelectedCandle] = useState<CandleData | undefined>(data.at(-1));
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [livePriceY, setLivePriceY] = useState<number | null>(null);

  const targetCount = chartWidth < 520 ? MOBILE_CANDLE_COUNT : DESKTOP_CANDLE_COUNT;
  const visibleCount = fullRange
    ? data.length
    : Math.min(data.length, Math.max(6, Math.round(targetCount / zoom)));
  const chartSpan = data.length > 1 ? data[data.length - 1].timestamp - data[0].timestamp : 0;
  const showDateOnTicks = chartSpan >= 24 * 60 * 60_000;
  const latestCandle = data.at(-1);
  const markerPrice = livePrice ?? latestCandle?.close;
  const markerTone = markerPrice != null && latestCandle && markerPrice >= latestCandle.open ? 'up' : 'down';
  const candleEndsAt = latestCandle ? latestCandle.timestamp + candleIntervalMs[interval] : 0;
  const countdown = candleEndsAt > 0 ? formatCountdown(candleEndsAt - now) : '--:--:--';

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
    setSelectedCandle(data.at(-1));
  }, [data, interval]);

  useEffect(() => {
    candleDataRef.current = data;
    candleLookupRef.current = new Map(data.map((candle) => [Math.floor(candle.timestamp / 1000), candle]));
  }, [data]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setLivePrice(null);
    const normalizedSymbol = coinSymbol?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (currency !== 'usd' || !normalizedSymbol || typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
      return undefined;
    }

    let active = true;
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(`wss://stream.binance.com:9443/ws/${normalizedSymbol.toLowerCase()}usdt@trade`);
    } catch {
      return undefined;
    }
    socket.onmessage = (event) => {
      if (!active) return;
      try {
        const payload = JSON.parse(String(event.data)) as { p?: string };
        const price = Number(payload.p);
        if (Number.isFinite(price) && price > 0) setLivePrice(price);
      } catch {
        // Ignore malformed stream messages and keep the chart running on its latest candle.
      }
    };
    return () => {
      active = false;
      socket?.close();
    };
  }, [coinSymbol, currency]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const chart = createChart(mount, {
      autoSize: true,
      height: CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: CHART_BG },
        textColor: MUTED_TEXT,
        fontFamily: 'JetBrains Mono',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,.045)' },
        horzLines: { color: 'rgba(255,255,255,.07)', style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.08 },
        minimumWidth: 58,
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 0,
        barSpacing: BAR_SPACING,
        minBarSpacing: 4,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: 'rgba(255,255,255,.22)', style: LineStyle.Dashed, labelVisible: false },
        horzLine: { color: 'rgba(255,255,255,.22)', style: LineStyle.Dashed, labelVisible: true },
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
      localization: {
        priceFormatter: formatAxisPrice,
        timeFormatter: (time: Time) => formatTime(getTimeMilliseconds(time), showDateOnTicks),
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderVisible: false,
      wickVisible: true,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      base: 0,
      lastValueVisible: false,
      priceLineVisible: false,
    }, 1);
    volumeSeries.priceScale().applyOptions({ visible: false });
    const averageSeries = chart.addSeries(LineSeries, {
      color: '#a855f7',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      visible: false,
    });

    chartApiRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    averageSeriesRef.current = averageSeries;

    const handleCrosshairMove = (param: MouseEventParams) => {
      const currentSeries = candleSeriesRef.current;
      if (!currentSeries) return;
      const bar = param.seriesData.get(currentSeries) as CandlestickData | undefined;
      if (!bar || typeof bar.time !== 'number') {
        setSelectedCandle(candleDataRef.current.at(-1));
        return;
      }
      setSelectedCandle(candleLookupRef.current.get(Number(bar.time)) ?? candleDataRef.current.at(-1));
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      averageSeriesRef.current = null;
    };
  }, [showDateOnTicks]);

  useEffect(() => {
    const chart = chartApiRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const averageSeries = averageSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries || !averageSeries) return;

    const candleData: CandlestickData[] = data.map((candle) => ({
      time: getCandleTime(candle.timestamp),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    const volumeData: HistogramData[] = data.map((candle) => ({
      time: getCandleTime(candle.timestamp),
      value: Math.max(0, candle.volume),
      color: candle.close >= candle.open ? 'rgba(0,229,139,.52)' : 'rgba(255,91,116,.52)',
    }));
    const averageData = data.map((candle, index) => {
      const start = Math.max(0, index - 19);
      const average = data.slice(start, index + 1).reduce((sum, item) => sum + item.close, 0) / (index - start + 1);
      return { time: getCandleTime(candle.timestamp), value: average };
    });

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);
    averageSeries.setData(averageData);
    volumeSeries.applyOptions({ visible: showVolume });
    averageSeries.applyOptions({ visible: showAverage });
    candleSeries.priceScale().applyOptions({ mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });

    const volumePane = chart.panes()[1];
    volumePane?.setHeight(showVolume ? 84 : 1);
    const spacing = Math.max(4, Math.min(26, (chartWidth - PRICE_SCALE_WIDTH - 4) / Math.max(visibleCount, 1)));
    chart.timeScale().applyOptions({ barSpacing: spacing });
    if (data.length > 0) {
      const rangeCount = fullRange ? data.length : visibleCount;
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, data.length - rangeCount),
        to: data.length - 1,
      });
    }
  }, [chartWidth, data, fullRange, logScale, showAverage, showVolume, visibleCount]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    const element = chartRef.current;
    if (!series || !element || markerPrice == null) {
      setLivePriceY(null);
      return;
    }
    const coordinate = series.priceToCoordinate(markerPrice);
    const chartRect = element.getBoundingClientRect();
    const tvElement = element.querySelector<HTMLElement>('.tv-lightweight-charts');
    const firstCanvas = element.querySelector<HTMLCanvasElement>('.tv-lightweight-charts canvas');
    if (coordinate == null || !tvElement || !firstCanvas) {
      setLivePriceY(null);
      return;
    }
    const tvRect = tvElement.getBoundingClientRect();
    const paneRect = firstCanvas.getBoundingClientRect();
    const offset = tvRect.top - chartRect.top;
    const paneTop = paneRect.top - chartRect.top;
    const paneBottom = paneRect.bottom - chartRect.top;
    const y = Math.max(paneTop + 4, Math.min(paneBottom - 4, offset + coordinate));
    setLivePriceY(y);
  }, [chartWidth, data, fullRange, logScale, markerPrice, showVolume, visibleCount]);

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

  const selected = selectedCandle ?? data.at(-1);
  const selectedTime = selected ? formatTime(selected.timestamp, showDateOnTicks) : '';

  return (
    <div className="candle-chart-shell">
      <div
        ref={chartRef}
        className="candle-chart"
        role="img"
        aria-label={`${interval} candlestick chart for ${coinName}. ${visibleCount} visible candles.`}
        onWheel={handleWheel}
      >
        <div ref={mountRef} className="candle-chart-mount" aria-hidden="true" />
        <div className="candle-readout" aria-live="polite">
          <span className="candle-readout-title">{interval} · {selectedTime}</span>
          {selected && (
            <span className="candle-readout-values">
              <b>O</b> {formatCurrency(selected.open, currency)}
              <b>H</b> {formatCurrency(selected.high, currency)}
              <b>L</b> {formatCurrency(selected.low, currency)}
              <b>C</b> <em className={selected.close >= selected.open ? 'up' : 'down'}>{formatCurrency(selected.close, currency)}</em>
            </span>
          )}
        </div>
        <div className="candle-chart-toolbar" aria-label="Candle chart zoom controls">
          <span>{fullRange ? `ALL · ${data.length}` : `VIEW · ${visibleCount}`}</span>
          <button type="button" onClick={zoomOut} disabled={fullRange || zoom === 1} aria-label="Zoom out">−</button>
          <button type="button" onClick={zoomIn} disabled={zoom === 6} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => setFullRange(true)} disabled={fullRange}>All</button>
          <button type="button" onClick={resetView} disabled={!fullRange && zoom === 1}>Reset</button>
        </div>
        {livePriceY != null && markerPrice != null && (
          <>
            <div className={`candle-live-line ${markerTone}`} style={{ top: livePriceY }} aria-hidden="true" />
            <div className={`candle-live-marker ${markerTone}`} style={{ top: livePriceY }} aria-label={`Live price ${formatPriceAxis(markerPrice)}. Candle closes in ${countdown}`}>
              <strong>{formatPriceAxis(markerPrice)}</strong>
              <time>{countdown}</time>
            </div>
          </>
        )}
      </div>
      <a className="candle-chart-attribution" href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a>
    </div>
  );
};

export default CandlestickChart;
