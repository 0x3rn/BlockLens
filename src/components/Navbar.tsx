import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  BellRing,
  Bot,
  CandlestickChart,
  GitCompareArrows,
  History,
  LayoutDashboard,
  RefreshCw,
  TrendingUp,
  WalletCards,
  UserRound,
} from 'lucide-react';
import { useMarket } from '../context/MarketContext';
import { CurrencyCode } from '../types/crypto';
import { formatDateTime } from '../utils/format';
import { useAuth } from '../context/AuthContext';
import '../styles/Navbar.css';

const tabs = [
  { to: '/', end: true, label: 'Dashboard', mobileLabel: 'Home', icon: LayoutDashboard },
  { to: '/markets', label: 'Markets', mobileLabel: 'Markets', icon: TrendingUp },
  { to: '/analysis', label: 'AI Brief', mobileLabel: 'AI', icon: Bot },
  { to: '/watchlist', label: 'Portfolio', mobileLabel: 'Portfolio', icon: WalletCards },
  { to: '/history', label: 'History', mobileLabel: 'History', icon: History },
  { to: '/futures', label: 'Futures', mobileLabel: 'Trade', icon: CandlestickChart },
  { to: '/compare', label: 'Compare', mobileLabel: 'Compare', icon: GitCompareArrows },
];

const Navbar: React.FC = () => {
  const {
    currency,
    setCurrency,
    error,
    lastUpdated,
    refreshing,
    refresh,
    alerts,
  } = useMarket();
  const triggeredAlerts = alerts.filter((alert) => alert.triggeredAt).length;
  const { configured, user } = useAuth();

  return (
    <>
      <nav className="navbar" aria-label="Primary navigation">
        <div className="nav-container">
          <Link className="nav-logo" to="/" aria-label="BlockLens dashboard">
            <span className="logo-icon-wrap" aria-hidden="true">
              <img className="logo-mark" src="/blocklens-logo.png" alt="" />
            </span>
            <span>BlockLens</span>
          </Link>

          <div className="nav-links">
            {tabs.map(({ to, end, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>

          <div className="nav-right">
            {triggeredAlerts > 0 && (
              <Link className="alert-indicator" to="/watchlist#alerts" aria-label={`${triggeredAlerts} triggered alerts`}>
                <BellRing size={16} aria-hidden="true" />
                <span>{triggeredAlerts}</span>
              </Link>
            )}
            <label className="currency-control">
              <span className="sr-only">Display currency</span>
              <select
                value={currency}
                onChange={(event) => setCurrency(event.target.value as CurrencyCode)}
              >
                <option value="usd">USD</option>
                <option value="eur">EUR</option>
                <option value="gbp">GBP</option>
                <option value="ngn">NGN</option>
              </select>
            </label>
            <button
              type="button"
              className="refresh-button"
              onClick={() => void refresh()}
              disabled={refreshing}
              aria-label="Refresh market data"
              title="Refresh market data"
            >
              <RefreshCw size={15} className={refreshing ? 'is-spinning' : ''} aria-hidden="true" />
            </button>
            <Link className="account-link" to="/account" aria-label={user ? `Account for ${user.email}` : 'Open account'} title={user?.email ?? 'Account'}>
              <UserRound size={15} aria-hidden="true" />
              <span>{configured && user ? 'Account' : 'Sign in'}</span>
            </Link>
            <div
              className={`nav-live-indicator ${error ? 'has-error' : ''}`}
              title={error ?? `Updated ${formatDateTime(lastUpdated)}`}
            >
              <span className="live-dot-pulse" aria-hidden="true" />
              <span>{error ? 'Data issue' : lastUpdated ? 'Updated' : 'Connecting'}</span>
            </div>
          </div>
        </div>
      </nav>

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {tabs.map(({ to, end, mobileLabel, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{mobileLabel}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
};

export default Navbar;
