import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAIHistory } from './useAIHistory';
import type { AIAnalysis, AIAnalysisHistoryEntry } from '../types/crypto';

const cloud = vi.hoisted(() => ({ user: null as { id: string } | null, rows: [] as Record<string, unknown>[] }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: cloud.user, loading: false }) }));
vi.mock('../lib/database', () => ({ database: { from: () => {
  const query = { select: () => query, eq: () => query, order: () => query,
    limit: async () => ({ data: cloud.rows, error: null }),
    upsert: async (row: Record<string, unknown>) => { cloud.rows.push(row); return { error: null }; },
  };
  return query;
} } }));

const analysis: AIAnalysis = {
  mode: 'swing', headline: 'A conditional setup', summary: 'Closed-candle evidence.', stance: 'neutral', confidence: 60, risk: 'high',
  timeframe: '3 days–4 weeks', supportLevels: [], resistanceLevels: [], scenarios: [],
  tradeSetup: { signal: 'no-trade', rationale: 'Wait for a trigger.', entryZone: '$100', stopLoss: '$95', takeProfitLevels: [], riskReward: '1:2', invalidation: 'Break of support.', positionRisk: 'Define a loss limit.' },
  methodology: 'Closed candles.', research: { status: 'unavailable', coinCatalysts: [], macroCatalysts: [], sources: [], note: 'Technical-only.' },
  dataAsOf: '2026-10-09T00:00:00Z', generatedAt: '2026-10-09T00:00:00Z',
};
const input = (riskProfile?: AIAnalysis['riskProfile']): Omit<AIAnalysisHistoryEntry, 'id' | 'createdAt'> => ({
  coinId: 'bitcoin', coinName: 'Bitcoin', coinSymbol: 'btc', currency: 'usd', price: 100,
  analysis: { ...analysis, ...(riskProfile ? { riskProfile } : {}) },
});

beforeEach(() => { cloud.user = null; cloud.rows = []; window.localStorage.clear(); });
afterEach(cleanup);

describe('AI approach history persistence', () => {
  it('preserves legacy and Risk briefs across local reloads', () => {
    const first = renderHook(useAIHistory);
    act(() => first.result.current.saveAnalysis(input()));
    act(() => first.result.current.saveAnalysis(input('risk')));
    first.unmount();
    const reloaded = renderHook(useAIHistory);
    expect(reloaded.result.current.history).toHaveLength(2);
    expect(reloaded.result.current.history[0].analysis.riskProfile).toBe('risk');
    expect(reloaded.result.current.history[1].analysis.riskProfile).toBeUndefined();
  });

  it('saves Risk to cloud history and defaults older cloud briefs to Conservative', async () => {
    cloud.user = { id: 'test-user' };
    cloud.rows = [{ id: 'legacy', coin_id: 'bitcoin', coin_name: 'Bitcoin', coin_symbol: 'btc', currency: 'usd', price: 100, analysis,
      created_at: '2026-10-08T00:00:00Z' }];
    const first = renderHook(useAIHistory);
    await waitFor(() => expect(first.result.current.history).toHaveLength(1));
    expect(first.result.current.history[0].analysis.riskProfile).toBe('conservative');
    act(() => first.result.current.saveAnalysis(input('risk')));
    first.unmount();
    const reloaded = renderHook(useAIHistory);
    await waitFor(() => expect(reloaded.result.current.history).toHaveLength(2));
    expect(reloaded.result.current.history[0].analysis.riskProfile).toBe('risk');
    expect(reloaded.result.current.history[1].analysis.riskProfile).toBe('conservative');
  });
});
