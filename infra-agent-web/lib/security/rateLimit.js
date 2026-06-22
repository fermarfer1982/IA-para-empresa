const buckets = new Map();

function keyFor({ username, ip }) {
  return `${String(username || "unknown").toLowerCase()}::${String(ip || "unknown")}`;
}

export function checkLoginRateLimit({ username, ip, windowMs, maxAttempts }) {
  const now = Date.now();
  const key = keyFor({ username, ip });
  const current = buckets.get(key) || { attempts: 0, resetAt: now + windowMs };

  if (current.resetAt <= now) {
    const next = { attempts: 1, resetAt: now + windowMs };
    buckets.set(key, next);
    return { allowed: true, remaining: Math.max(0, maxAttempts - 1), resetAt: next.resetAt };
  }

  if (current.attempts >= maxAttempts) {
    return { allowed: false, remaining: 0, resetAt: current.resetAt };
  }

  current.attempts += 1;
  buckets.set(key, current);
  return { allowed: true, remaining: Math.max(0, maxAttempts - current.attempts), resetAt: current.resetAt };
}

export function clearLoginRateLimit({ username, ip }) {
  buckets.delete(keyFor({ username, ip }));
}
