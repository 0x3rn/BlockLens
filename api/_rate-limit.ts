const rateWindowMs = 60_000;
const requestLimit = 8;
const maxTrackedKeys = 5_000;
const maxConcurrentAnalyses = 4;

type RateBucket = {
  count: number;
  windowStartedAt: number;
};

const requestLog = new Map<string, RateBucket>();
let activeAnalyses = 0;

const removeExpiredBuckets = (now: number) => {
  for (const [entryKey, bucket] of requestLog) {
    if (now - bucket.windowStartedAt >= rateWindowMs) requestLog.delete(entryKey);
  }
};

export const isRateLimited = (key: string): boolean => {
  const now = Date.now();
  const bucket = requestLog.get(key);
  if (bucket && now - bucket.windowStartedAt < rateWindowMs) {
    if (bucket.count >= requestLimit) return true;
    bucket.count += 1;
    return false;
  }

  if (!bucket && requestLog.size >= maxTrackedKeys) removeExpiredBuckets(now);
  if (!bucket && requestLog.size >= maxTrackedKeys) return true;

  requestLog.set(key, { count: 1, windowStartedAt: now });
  return false;
};

export const acquireAnalysisSlot = (): (() => void) | null => {
  if (activeAnalyses >= maxConcurrentAnalyses) return null;
  activeAnalyses += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeAnalyses = Math.max(0, activeAnalyses - 1);
  };
};

export const resetAnalysisAdmissionForTests = () => {
  requestLog.clear();
  activeAnalyses = 0;
};
