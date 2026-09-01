import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { Link, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import './styles/App.css';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const MarketsPage = lazy(() => import('./pages/MarketsPage'));
const AnalysisPage = lazy(() => import('./pages/AnalysisPage'));
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'));
const ComparePage = lazy(() => import('./pages/ComparePage'));
const CoinDetailPage = lazy(() => import('./components/CoinDetail'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

const ScrollToTop: React.FC = () => {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [pathname]);
  return null;
};

const PageLoader: React.FC = () => (
  <main className="app-container page-stack"><div className="route-loader" role="status"><span /> Loading workspace…</div></main>
);

const RouteTransition: React.FC = () => {
  const location = useLocation();
  const routeKey = `${location.pathname}${location.search}`;
  const previousRoute = useRef(routeKey);
  const [isNavigating, setIsNavigating] = useState(false);

  useEffect(() => {
    if (previousRoute.current === routeKey) return undefined;
    previousRoute.current = routeKey;
    setIsNavigating(true);
    const timer = window.setTimeout(() => setIsNavigating(false), 420);
    return () => window.clearTimeout(timer);
  }, [routeKey]);

  return isNavigating ? <div className="route-transition" role="status" aria-live="polite"><span /> Loading page</div> : null;
};

const AppShell: React.FC = () => (
  <div className="dashboard-root">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <ScrollToTop />
    <Navbar />
    <RouteTransition />
    <div id="main-content">
      <Suspense fallback={<PageLoader />}><Outlet /></Suspense>
    </div>
    <footer className="site-footer">
      <p><strong>BlockLens</strong> is an educational market workspace. Data may be delayed and is not financial advice.</p>
      <p>Market data by <a href="https://www.coingecko.com/" target="_blank" rel="noreferrer">CoinGecko</a> · Built by <a href="https://somto.xyz" target="_blank" rel="noreferrer">Somto Ike</a> · <Link to="/markets">Markets</Link></p>
    </footer>
  </div>
);

const App: React.FC = () => (
  <>
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="markets" element={<MarketsPage />} />
        <Route path="analysis" element={<AnalysisPage />} />
        <Route path="watchlist" element={<PortfolioPage />} />
        <Route path="compare" element={<ComparePage />} />
        <Route path="coin/:coinId" element={<CoinDetailPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    <Analytics />
  </>
);

export default App;
