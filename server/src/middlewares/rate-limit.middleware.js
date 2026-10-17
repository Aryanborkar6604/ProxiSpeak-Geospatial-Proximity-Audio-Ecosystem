function createRateLimiter({ windowMs, max, message }) {
  const buckets = new Map();
  let lastSweepAt = 0;

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    let bucket = buckets.get(key);

    if (!bucket && buckets.size >= 50_000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
      if (buckets.size >= 50_000) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' });
      }
    }

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (now - lastSweepAt > Math.min(windowMs, 60_000)) {
      lastSweepAt = now;
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.set('RateLimit-Reset', String(retryAfterSeconds));

    if (bucket.count > max) {
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: message || 'Too many requests. Try again later.' });
    }

    return next();
  };
}

module.exports = { createRateLimiter };
