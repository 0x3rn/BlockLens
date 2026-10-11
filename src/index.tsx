import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MarketProvider } from './context/MarketContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './index.css';
import './styles/CoinDetail.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <MarketProvider>
            <App />
          </MarketProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>,
);
