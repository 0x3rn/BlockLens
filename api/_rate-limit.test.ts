import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireAnalysisSlot, isRateLimited, resetAnalysisAdmissionForTests } from './_rate-limit';

describe('analysis admission controls', () => {
  afterEach(() => {
    resetAnalysisAdmissionForTests();
    vi.useRealTimers();
  });

  it('retains constant state after the request allowance is exhausted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T00:00:00.000Z'));
    for (let index = 0; index < 8; index += 1) expect(isRateLimited('caller')).toBe(false);
    for (let index = 0; index < 1_000; index += 1) expect(isRateLimited('caller')).toBe(true);
    vi.advanceTimersByTime(60_001);
    expect(isRateLimited('caller')).toBe(false);
  });

  it('fails closed when the bounded caller map is full', () => {
    for (let index = 0; index < 5_000; index += 1) expect(isRateLimited(`caller-${index}`)).toBe(false);
    expect(isRateLimited('caller-over-capacity')).toBe(true);
  });

  it('caps concurrent provider work and releases slots idempotently', () => {
    const releases = Array.from({ length: 4 }, () => acquireAnalysisSlot());
    expect(releases.every(Boolean)).toBe(true);
    expect(acquireAnalysisSlot()).toBeNull();
    releases[0]?.();
    releases[0]?.();
    expect(acquireAnalysisSlot()).not.toBeNull();
  });
});
