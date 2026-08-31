import React from 'react';
import { ArrowLeft, Telescope } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../hooks/usePageMeta';

const NotFoundPage: React.FC = () => {
  usePageMeta('Page Not Found', 'The requested BlockLens page could not be found.');
  return (
    <main className="app-container page-stack">
      <section className="not-found-card">
        <Telescope size={44} aria-hidden="true" />
        <span className="eyebrow">404 · Outside the chart</span>
        <h1>This page does not exist.</h1>
        <p>The link may be outdated, or the address may have been entered incorrectly.</p>
        <Link className="primary-button" to="/"><ArrowLeft size={16} /> Return to dashboard</Link>
      </section>
    </main>
  );
};

export default NotFoundPage;
