import { describe, expect, it } from 'vitest';
import { formatCurrency, formatPercent, formatPriceAxis } from './format';

describe('market formatting', () => {
  it('does not round micro-priced assets to zero', () => {
    const formatted = formatCurrency(0.000012345, 'usd');
    expect(formatted).not.toBe('$0.00');
    expect(formatted).toContain('0.000012');
  });

  it('formats positive and negative percentages consistently', () => {
    expect(formatPercent(3.456)).toBe('+3.46%');
    expect(formatPercent(-2)).toBe('-2.00%');
    expect(formatPercent(null)).toBe('N/A');
  });

  it('keeps chart price axes free of currency symbols', () => {
    expect(formatPriceAxis(102345.67, 'usd')).not.toContain('$');
    expect(formatPriceAxis(0.000012345, 'usd')).toContain('0.000012');
  });
});
