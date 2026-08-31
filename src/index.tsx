import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MarketProvider } from './context/MarketContext';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <MarketProvider>
        <App />
      </MarketProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
