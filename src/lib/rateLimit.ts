/**
 * In-memory fixed-window rate limiter. The server is one process (docker-compose runs a single app
 * container), so memory is the shared store; a restart forgets the counters, which only ever errs
 * towards letting someone try again. Swap for a shared store if this ever runs as several processes.
 *
 * Every sensitive endpoint limits on two keys at once — the target (an address or phone number, so no
 * amount of changing IP gets more guesses at one account) and the client address (so one client
 * cannot sweep many accounts) — see hitLimits().
 */

export interface Limit {
  max: number;
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const MINUTE = 60_000;

export const LIMITS = {
  /** Password sign-in, per account (+ per address). */
  loginPerAccount: { max: 10, windowMs: 15 * MINUTE },
  loginPerIp: { max: 40, windowMs: 15 * MINUTE },
  registerPerIp: { max: 5, windowMs: 60 * MINUTE },
  /** Asking for a one-time code (any purpose). The per-target cooldown lives in otp.ts. */
  codeRequestPerIp: { max: 15, windowMs: 60 * MINUTE },
  /** Typing a one-time code. Each code also dies after 5 wrong tries (otp.ts). */
  codeVerifyPerIp: { max: 40, windowMs: 15 * MINUTE },
  codeVerifyPerTarget: { max: 15, windowMs: 15 * MINUTE },
  passwordChangePerAccount: { max: 10, windowMs: 60 * MINUTE },
  /**
   * The public research form (/api/checkup), per address — an IPv6 address counts by its /64 (see
   * checkupServer.ts). Generous on purpose: Iranian mobile carriers put many people behind one address
   * (CGNAT), and a refused save still shows the person their report; the form simply queues it.
   * A new answer sheet: */
  checkupNewPerIp: { max: 30, windowMs: 60 * MINUTE },
  /** Any page save or report event (a full form is ~7 writes). */
  checkupWritePerIp: { max: 300, windowMs: 60 * MINUTE },
} satisfies Record<string, Limit>;

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

/** Drop expired windows now and then, so a flood of distinct keys cannot grow memory without bound. */
function sweep(now: number): void {
  if (now - lastSweep < MINUTE && buckets.size < 50_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

export function checkRateLimit(key: string, limit: Limit = LIMITS.loginPerAccount): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    return { allowed: true, remaining: limit.max - 1, retryAfterMs: 0 };
  }

  if (bucket.count >= limit.max) {
    return { allowed: false, remaining: 0, retryAfterMs: bucket.resetAt - now };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit.max - bucket.count, retryAfterMs: 0 };
}

/** Counts one hit against every key; refused when any of them is over its limit. */
export function hitLimits(checks: Array<[key: string, limit: Limit]>): { allowed: boolean; retryAfterMs: number } {
  let allowed = true;
  let retryAfterMs = 0;
  for (const [key, limit] of checks) {
    const result = checkRateLimit(key, limit);
    if (!result.allowed) {
      allowed = false;
      retryAfterMs = Math.max(retryAfterMs, result.retryAfterMs);
    }
  }
  return { allowed, retryAfterMs };
}

/** Forget a key's window (a successful sign-in clears that account's failure count). */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Tests only. */
export function resetAllRateLimits(): void {
  buckets.clear();
}
