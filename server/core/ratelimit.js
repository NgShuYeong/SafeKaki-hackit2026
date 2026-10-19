// Small in-memory sliding-window limiter. Good for a single process.
// For multiple instances, replace the Map with Redis.
export function createLimiter({ windowMs, max }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, arr] of hits) {
      const kept = arr.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept); else hits.delete(k);
    }
  }, Math.max(windowMs, 30000));
  timer.unref?.();
  return {
    check(key) {
      const now = Date.now();
      const arr = (hits.get(key) || []).filter((t) => t > now - windowMs);
      if (arr.length >= max) {
        hits.set(key, arr);
        return { allowed: false, retryAfterSec: Math.ceil((arr[0] + windowMs - now) / 1000) };
      }
      arr.push(now);
      hits.set(key, arr);
      return { allowed: true, remaining: max - arr.length };
    },
  };
}
