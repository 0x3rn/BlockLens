import React, { useMemo } from 'react';
import { Crosshair, Radar } from 'lucide-react';
import { Coin, CurrencyCode } from '../types/crypto';
import { formatCurrency, formatPercent } from '../utils/format';
import '../styles/MarketLens.css';

interface MarketLensProps {
  coins: Coin[];
  currency: CurrencyCode;
}

const stablecoinSymbols = new Set([
  'usdt', 'usdc', 'dai', 'usds', 'usde', 'usdg', 'pyusd', 'fdusd', 'tusd', 'usdd', 'rlusd', 'usd1',
]);

const MarketLens: React.FC<MarketLensProps> = ({ coins, currency }) => {
  const snapshot = useMemo(() => {
    const assets = coins.filter((coin) => !stablecoinSymbols.has(coin.symbol.toLowerCase()));
    const measured = assets.filter((coin) => coin.price_change_percentage_24h != null);
    const positive = measured.filter((coin) => (coin.price_change_percentage_24h ?? 0) > 0);
    const negative = measured.filter((coin) => (coin.price_change_percentage_24h ?? 0) < 0);
    return {
      lead: assets[0] ?? null,
      orbit: assets.slice(1, 5),
      biggestGainer: positive.reduce<Coin | null>((current, coin) => (
        !current || (coin.price_change_percentage_24h ?? 0) > (current.price_change_percentage_24h ?? 0) ? coin : current
      ), null),
      biggestLoser: negative.reduce<Coin | null>((current, coin) => (
        !current || (coin.price_change_percentage_24h ?? 0) < (current.price_change_percentage_24h ?? 0) ? coin : current
      ), null),
      gainers: positive.length,
      losers: negative.length,
      flat: measured.length - positive.length - negative.length,
    };
  }, [coins]);

  return (
    <aside className="market-lens" aria-labelledby="market-lens-title">
      <div className="market-lens-heading">
        <span id="market-lens-title"><Radar size={14} aria-hidden="true" /> Market Lens</span>
        <span className={snapshot.lead ? 'lens-status live' : 'lens-status'}><i aria-hidden="true" />{snapshot.lead ? 'Live snapshot' : 'Awaiting feed'}</span>
      </div>

      <div className="lens-stage" aria-label={snapshot.lead ? `${snapshot.lead.name} market snapshot` : 'Waiting for market data'}>
        <span className="lens-coordinate top left">BL / MARKET 01</span>
        <span className="lens-coordinate top right">TOP 5 · NON-STABLE · 24H</span>
        <div className="lens-axis horizontal" aria-hidden="true" />
        <div className="lens-axis vertical" aria-hidden="true" />
        <div className="lens-ring lens-ring-outer" aria-hidden="true" />
        <div className="lens-ring lens-ring-inner" aria-hidden="true" />
        <div className="lens-scan" aria-hidden="true" />

        {snapshot.orbit.map((coin, index) => (
          <span
            className={`lens-orbit-token token-${index + 1}`}
            key={coin.id}
            aria-label={`${coin.name}, ${formatCurrency(coin.current_price, currency)}, ${formatPercent(coin.price_change_percentage_24h)} over 24 hours`}
          >
            <img src={coin.image} alt="" />
            <span className="lens-orbit-copy">
              <b>{coin.name}</b>
              <strong>{formatCurrency(coin.current_price, currency)}</strong>
              <small className={(coin.price_change_percentage_24h ?? 0) >= 0 ? 'text-up' : 'text-down'}>
                {coin.symbol.toUpperCase()} · {formatPercent(coin.price_change_percentage_24h)}
              </small>
            </span>
          </span>
        ))}

        <div className="lens-core">
          {snapshot.lead ? (
            <>
              <img src={snapshot.lead.image} alt="" />
              <span>{snapshot.lead.symbol.toUpperCase()} / {currency.toUpperCase()}</span>
              <strong>{formatCurrency(snapshot.lead.current_price, currency)}</strong>
              <small className={(snapshot.lead.price_change_percentage_24h ?? 0) >= 0 ? 'text-up' : 'text-down'}>
                {formatPercent(snapshot.lead.price_change_percentage_24h)} · 24H
              </small>
            </>
          ) : (
            <><Crosshair size={23} aria-hidden="true" /><strong>Loading market</strong><small>Market feed pending</small></>
          )}
        </div>
      </div>

      <div className="lens-readouts">
        <div>
          <span>Non-stable asset breadth</span>
          <strong>{snapshot.lead ? <>{snapshot.gainers}<small> up</small> · {snapshot.losers}<small> down</small> · {snapshot.flat}<small> flat</small></> : 'N/A'}</strong>
        </div>
        <div>
          <span>Biggest 24h gainer</span>
          <strong className="text-up">
            {snapshot.biggestGainer ? `${snapshot.biggestGainer.symbol.toUpperCase()} ${formatPercent(snapshot.biggestGainer.price_change_percentage_24h)}` : 'N/A'}
          </strong>
        </div>
        <div>
          <span>Biggest 24h loser</span>
          <strong className="text-down">
            {snapshot.biggestLoser ? `${snapshot.biggestLoser.symbol.toUpperCase()} ${formatPercent(snapshot.biggestLoser.price_change_percentage_24h)}` : 'N/A'}
          </strong>
        </div>
      </div>
    </aside>
  );
};

export default MarketLens;
