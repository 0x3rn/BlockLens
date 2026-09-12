import type { AIAnalysisCandleInterval, AIAnalysisMode } from '../types/crypto.ts';

export type AnalysisModeDefinition = {
  label: string;
  holdingPeriod: string;
  description: string;
  intervals: Array<{ interval: AIAnalysisCandleInterval; limit: number }>;
};

export const analysisModeDefinitions: Record<AIAnalysisMode, AnalysisModeDefinition> = {
  'short-term': {
    label: 'Short-term',
    holdingPeriod: '6 hours–3 days',
    description: '15m entries, 1H momentum, 4H structure, and the daily trend.',
    intervals: [
      { interval: '15m', limit: 192 },
      { interval: '1h', limit: 168 },
      { interval: '4h', limit: 180 },
      { interval: '1d', limit: 180 },
    ],
  },
  swing: {
    label: 'Swing',
    holdingPeriod: '3 days–4 weeks',
    description: '4H entries, daily structure, and the weekly market regime.',
    intervals: [
      { interval: '4h', limit: 180 },
      { interval: '1d', limit: 365 },
      { interval: '1w', limit: 104 },
    ],
  },
  'long-term': {
    label: 'Long-term',
    holdingPeriod: '1–12+ months',
    description: 'Daily timing, weekly structure, and the monthly market cycle.',
    intervals: [
      { interval: '1d', limit: 730 },
      { interval: '1w', limit: 156 },
      { interval: '1M', limit: 60 },
    ],
  },
};

export const isAIAnalysisMode = (value: unknown): value is AIAnalysisMode => (
  value === 'short-term' || value === 'swing' || value === 'long-term'
);
