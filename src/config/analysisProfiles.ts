import type { AIAnalysisRiskProfile } from '../types/crypto.ts';

export const analysisProfileDefinitions: Record<AIAnalysisRiskProfile, { label: string; title: string; description: string; tradeoff: string }> = {
  conservative: {
    label: 'Conservative',
    title: 'Wait for stronger confirmation',
    description: 'Prioritize agreement across timeframes and established trends. Stay out when the evidence does not support a clear setup.',
    tradeoff: 'Fewer setups, with more confirmation before entry.',
  },
  risk: {
    label: 'Risk',
    title: 'Explore earlier opportunities',
    description: 'Consider emerging momentum, breakouts, and reversals before every timeframe agrees. Each setup still needs a clear entry trigger and invalidation level.',
    tradeoff: 'Earlier entries can fail more often. Confidence reflects the evidence, not the selected approach.',
  },
};

export const isAIAnalysisRiskProfile = (value: unknown): value is AIAnalysisRiskProfile => value === 'conservative' || value === 'risk';
