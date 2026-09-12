import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Bot, Crosshair, ExternalLink, Gauge, LoaderCircle, RefreshCw, SearchCheck, ShieldAlert, Target } from 'lucide-react';
import PriceChart from '../components/PriceChart';
import { DataState } from '../components/DataState';
import { useMarket } from '../context/MarketContext';
import { useToast } from '../context/ToastContext';
import { usePageMeta } from '../hooks/usePageMeta';
import { getApiErrorMessage, requestAIAnalysis } from '../services/api';
import { analysisModeDefinitions, isAIAnalysisMode } from '../config/analysisModes';
import { AIAnalysis, AIAnalysisMode } from '../types/crypto';
import { formatCurrency, formatDateTime, formatPercent } from '../utils/format';

const AnalysisPage: React.FC = () => {
  const { coins, currency, refresh, error: marketError, saveAIAnalysis } = useMarket();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedCoin = searchParams.get('coin');
  const requestedMode = searchParams.get('mode');
  const [analysisMode, setAnalysisMode] = useState<AIAnalysisMode>(isAIAnalysisMode(requestedMode) ? requestedMode : 'swing');
  const selectedCoin = useMemo(() => (
    coins.find((coin) => coin.id === requestedCoin) ?? coins[0] ?? null
  ), [coins, requestedCoin]);
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const briefRef = useRef<HTMLElement>(null);
  const researchGroups = analysis ? [
    { label: 'Coin-specific', catalysts: analysis.research.coinCatalysts },
    { label: 'Macro', catalysts: analysis.research.macroCatalysts },
  ] : [];
  usePageMeta('AI Trading Analysis', 'Generate conditional LONG, SHORT, or NO TRADE setups with transparent risk controls from live price and volume history.');

  useEffect(() => {
    setAnalysis(null);
    setError(null);
  }, [selectedCoin?.id, currency, analysisMode]);

  const selectMode = (mode: AIAnalysisMode) => {
    setAnalysisMode(mode);
    const next = new URLSearchParams(searchParams);
    next.set('mode', mode);
    if (selectedCoin) next.set('coin', selectedCoin.id);
    setSearchParams(next);
  };

  useEffect(() => {
    if (!analysis) return undefined;
    const frame = window.requestAnimationFrame(() => {
      briefRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [analysis]);

  const handleAnalyze = async () => {
    if (!selectedCoin) return;
    setLoading(true);
    setError(null);
    try {
      const result = await requestAIAnalysis({
        coinId: selectedCoin.id,
        currency,
        mode: analysisMode,
      });
      setAnalysis(result);
      saveAIAnalysis({
        coinId: selectedCoin.id,
        coinName: selectedCoin.name,
        coinSymbol: selectedCoin.symbol,
        currency,
        price: selectedCoin.current_price,
        analysis: result,
      });
      showToast(`${selectedCoin.name} ${analysisModeDefinitions[analysisMode].label.toLowerCase()} analysis generated.`);
    } catch (analysisError) {
      const message = getApiErrorMessage(analysisError);
      setError(message);
      showToast('Trading analysis could not be generated.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app-container page-stack">
      <header className="markets-header page-header-card analysis-header">
        <div className="markets-title-wrap">
          <span className="markets-icon portfolio-icon"><Bot size={25} aria-hidden="true" /></span>
          <div>
            <span className="eyebrow">Technical trade planning</span>
            <h1>AI Trading Analysis</h1>
            <p>Choose a trading horizon, then combine closed exchange candles, computed indicators, and verified market catalysts.</p>
          </div>
        </div>
        <label className="coin-select-control">
          <span>Analyze asset</span>
          <select
            value={selectedCoin?.id ?? ''}
            onChange={(event) => setSearchParams({ coin: event.target.value, mode: analysisMode })}
            disabled={coins.length === 0}
          >
            {coins.map((coin) => <option value={coin.id} key={coin.id}>{coin.name} ({coin.symbol.toUpperCase()})</option>)}
          </select>
        </label>
      </header>

      <div className="disclaimer-alert analysis-disclaimer">
        <AlertTriangle size={17} className="warning-icon" aria-hidden="true" />
        <p><strong>Educational research only.</strong> Trade setups can be incomplete or wrong and are not personalized financial advice. Verify the levels independently, size risk conservatively, and never trade solely from generated output.</p>
      </div>

      <section className="analysis-mode-panel" aria-labelledby="analysis-horizon-title">
        <div className="analysis-mode-intro">
          <span className="eyebrow">Analysis horizon</span>
          <h2 id="analysis-horizon-title">Match the evidence to the trade</h2>
          <p>Each mode loads a different set of closed Binance Spot candles and searches for catalysts relevant to its holding period.</p>
        </div>
        <div className="analysis-mode-options" role="radiogroup" aria-label="Trading horizon">
          {(Object.entries(analysisModeDefinitions) as Array<[AIAnalysisMode, (typeof analysisModeDefinitions)[AIAnalysisMode]]>).map(([mode, definition]) => (
            <button
              type="button"
              role="radio"
              aria-checked={analysisMode === mode}
              className={`analysis-mode-option${analysisMode === mode ? ' is-active' : ''}`}
              onClick={() => selectMode(mode)}
              key={mode}
            >
              <span>{definition.label}</span>
              <strong>{definition.holdingPeriod}</strong>
              <small>{definition.description}</small>
            </button>
          ))}
        </div>
      </section>

      {selectedCoin ? (
        <>
          <section className="analysis-workspace">
            <div className="analysis-coin-card">
              <div className="analysis-coin-identity">
                <img src={selectedCoin.image} alt="" />
                <div>
                  <span className="eyebrow">#{selectedCoin.market_cap_rank} by market cap</span>
                  <h2>{selectedCoin.name} <small>{selectedCoin.symbol.toUpperCase()}</small></h2>
                </div>
              </div>
              <div className="analysis-coin-price">
                <strong>{formatCurrency(selectedCoin.current_price, currency)}</strong>
                <span className={(selectedCoin.price_change_percentage_24h ?? 0) >= 0 ? 'text-up' : 'text-down'}>
                  {formatPercent(selectedCoin.price_change_percentage_24h)} today
                </span>
              </div>
              {currency !== 'usd' && <p className="analysis-currency-note">Switch display currency to USD to use verified Binance Spot candle analysis.</p>}
              <button type="button" className="analyze-btn" onClick={() => void handleAnalyze()} disabled={loading || currency !== 'usd'} aria-busy={loading}>
                {loading ? <LoaderCircle size={17} className="is-spinning" aria-hidden="true" /> : <Bot size={17} aria-hidden="true" />}
                {loading ? `Generating ${analysisModeDefinitions[analysisMode].label.toLowerCase()} analysis` : `Generate ${analysisModeDefinitions[analysisMode].label.toLowerCase()} analysis`}
              </button>
              <Link className="text-link" to={`/coin/${selectedCoin.id}`}>
                Open full asset profile <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
            <PriceChart coinId={selectedCoin.id} coinSymbol={selectedCoin.symbol} coinName={selectedCoin.name} currency={currency} />
          </section>

          {error && (
            <section className="analysis-error-card" role="alert" aria-labelledby="analysis-error-title">
              <span className="analysis-error-icon"><ShieldAlert size={21} aria-hidden="true" /></span>
              <div className="analysis-error-copy">
                <span className="eyebrow">Analysis interrupted</span>
                <h2 id="analysis-error-title">The AI brief could not be generated</h2>
                <p>{error}</p>
                <small>Your selected asset and chart remain unchanged.</small>
              </div>
              <button type="button" className="analysis-retry-button" onClick={() => void handleAnalyze()} disabled={loading} aria-busy={loading}>
                <RefreshCw size={15} className={loading ? 'is-spinning' : ''} aria-hidden="true" />
                {loading ? 'Retrying' : 'Try analysis again'}
              </button>
            </section>
          )}

          {analysis && (
            <section ref={briefRef} className="ai-brief" aria-labelledby="brief-headline">
              <div className="brief-heading">
                <div>
                  <span className={`stance-badge ${analysis.stance}`}>{analysisModeDefinitions[analysis.mode].label} · {analysis.stance} bias</span>
                  <h2 id="brief-headline">{analysis.headline}</h2>
                  <p>{analysis.summary}</p>
                </div>
                <div className="confidence-card">
                  <Gauge size={20} aria-hidden="true" />
                  <span>Confidence</span>
                  <strong>{analysis.confidence}%</strong>
                  <div className="confidence-track" aria-hidden="true"><span style={{ width: `${analysis.confidence}%` }} /></div>
                </div>
              </div>

              <div className="brief-facts">
                <div><span>Risk</span><strong>{analysis.risk}</strong></div>
                <div><span>Timeframe</span><strong>{analysis.timeframe}</strong></div>
                <div><span>Data as of</span><strong>{formatDateTime(analysis.dataAsOf)}</strong></div>
                <div><span>Generated</span><strong>{formatDateTime(analysis.generatedAt)}</strong></div>
              </div>

              <section className={`research-card ${analysis.research.status}`} aria-labelledby="research-title">
                <div className="research-heading">
                  <span className="research-icon"><SearchCheck size={18} aria-hidden="true" /></span>
                  <div>
                    <span className="eyebrow">Market research</span>
                    <h3 id="research-title">{analysis.research.status === 'grounded' ? 'Google Search-grounded catalysts' : 'Technical-only brief'}</h3>
                  </div>
                </div>
                <p>{analysis.research.note}</p>
                {analysis.research.status === 'grounded' && (
                  <>
                    {researchGroups.map(({ label, catalysts }) => (
                      <div className="catalyst-group" key={label}>
                        <h4>{label}</h4>
                        {catalysts.length > 0 ? catalysts.map((catalyst) => (
                          <article className="catalyst-item" key={`${catalyst.title}-${catalyst.eventDate}`}>
                            <div><strong>{catalyst.title}</strong><span>{catalyst.status} · {catalyst.eventDate} · {catalyst.conditionalEffect}</span></div>
                            <p>{catalyst.mechanism}</p>
                          </article>
                        )) : <p className="research-empty">No verified events met the inclusion criteria.</p>}
                      </div>
                    ))}
                    <div className="research-sources">
                      <h4>Verified sources</h4>
                      {analysis.research.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.title}<ExternalLink size={12} aria-hidden="true" /></a>)}
                    </div>
                  </>
                )}
              </section>

              <section className={`trade-setup-card ${analysis.tradeSetup.signal}`} aria-labelledby="trade-setup-title">
                <div className="trade-setup-heading">
                  <span className="trade-setup-icon"><Crosshair size={19} aria-hidden="true" /></span>
                  <div><span className="eyebrow">{analysis.mode === 'long-term' ? 'Position thesis' : 'Conditional setup'}</span><h3 id="trade-setup-title">{analysis.tradeSetup.signal === 'no-trade' ? 'NO TRADE' : analysis.tradeSetup.signal.toUpperCase()}</h3></div>
                  <span className={`signal-badge ${analysis.tradeSetup.signal}`}>{analysis.tradeSetup.signal === 'no-trade' ? 'Wait' : analysis.tradeSetup.signal}</span>
                </div>
                <p className="trade-rationale">{analysis.tradeSetup.rationale}</p>
                <dl className="trade-levels">
                  <div><dt>{analysis.mode === 'long-term' ? 'Accumulation zone' : 'Entry zone'}</dt><dd>{analysis.tradeSetup.entryZone}</dd></div>
                  <div><dt>{analysis.mode === 'long-term' ? 'Thesis invalidation' : 'Stop loss'}</dt><dd>{analysis.tradeSetup.stopLoss}</dd></div>
                  <div><dt>Risk / reward</dt><dd>{analysis.tradeSetup.riskReward}</dd></div>
                  <div><dt>{analysis.mode === 'long-term' ? 'Review objectives' : 'Take profit'}</dt><dd>{analysis.tradeSetup.takeProfitLevels.join(' · ')}</dd></div>
                </dl>
                <div className="trade-risk-notes"><p><strong>Invalidation:</strong> {analysis.tradeSetup.invalidation}</p><p><strong>{analysis.mode === 'long-term' ? 'Allocation risk' : 'Position risk'}:</strong> {analysis.tradeSetup.positionRisk}</p></div>
              </section>

              <div className="levels-grid">
                <div><span><Target size={15} aria-hidden="true" /> Support</span><div>{analysis.supportLevels.map((level) => <strong key={level}>{level}</strong>)}</div></div>
                <div><span><Target size={15} aria-hidden="true" /> Resistance</span><div>{analysis.resistanceLevels.map((level) => <strong key={level}>{level}</strong>)}</div></div>
              </div>

              <div className="scenario-grid">
                {analysis.scenarios.map((scenario) => (
                  <article className={`scenario-card ${scenario.label.toLowerCase()}`} key={scenario.label}>
                    <h3>{scenario.label} scenario</h3>
                    <dl>
                      <div><dt>Trigger</dt><dd>{scenario.trigger}</dd></div>
                      <div><dt>Potential path</dt><dd>{scenario.target}</dd></div>
                      <div><dt>Invalidated by</dt><dd>{scenario.invalidatedBy}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>

              <div className="methodology-note"><strong>Methodology:</strong> {analysis.methodology}</div>
            </section>
          )}
        </>
      ) : (
        <DataState title="No market data yet" message={marketError ?? 'Retry the market feed before generating a brief.'} onRetry={refresh} />
      )}
    </main>
  );
};

export default AnalysisPage;
