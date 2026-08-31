import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flame } from 'lucide-react';
import { fetchTrendingCoins } from '../services/api';
import { TrendingCoin } from '../types/crypto';

const TrendingCoins: React.FC = () => {
  const [coins, setCoins] = useState<TrendingCoin[]>([]);

  useEffect(() => {
    let active = true;
    fetchTrendingCoins()
      .then((items) => { if (active) setCoins(items.slice(0, 7)); })
      .catch(() => { if (active) setCoins([]); });
    return () => { active = false; };
  }, []);

  if (coins.length === 0) return null;

  return (
    <section className="trending-panel" aria-labelledby="trending-title">
      <div className="section-heading compact-heading">
        <div>
          <span className="eyebrow"><Flame size={13} aria-hidden="true" /> Discovery</span>
          <h2 id="trending-title">Trending now</h2>
        </div>
      </div>
      <div className="trending-list">
        {coins.map((coin, index) => (
          <Link to={`/coin/${coin.id}`} className="trending-chip" key={coin.id}>
            <span className="trend-index">{index + 1}</span>
            <img src={coin.image} alt="" loading="lazy" />
            <span>
              <strong>{coin.name}</strong>
              <small>{coin.symbol.toUpperCase()}{coin.marketCapRank ? ` · #${coin.marketCapRank}` : ''}</small>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
};

export default TrendingCoins;
