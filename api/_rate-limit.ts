const rateWindowMs = 60_000;
const requestLimit = 8;
const requestLog = new Map<string, number[]>();

export const isRateLimited = (key: string): boolean => {
  const now = Date.now();
  const recent = (requestLog.get(key) ?? []).filter((timestamp) => now - timestamp < rateWindowMs);
  recent.push(now);
  requestLog.set(key, recent);
  if (requestLog.size > 5_000) {
    for (const [entryKey, timestamps] of requestLog) {
      if (timestamps.every((timestamp) => now - timestamp >= rateWindowMs)) requestLog.delete(entryKey);
    }
  }
  return recent.length > requestLimit;
};

