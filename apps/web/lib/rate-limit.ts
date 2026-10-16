import 'server-only';

/** Client IP as seen behind Cloud Run's load balancer. */
export const clientIp = (request: Request) =>
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

/**
 * A fixed-window limiter per key, in memory (per instance). Enough to blunt floods on the
 * public tracking routes; it isn't a global quota.
 */
export function rateLimiter(limit: number, windowMs = 60_000) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string, now = Date.now()) => {
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      if (hits.size > 10_000) hits.clear();
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    return ++entry.count <= limit;
  };
}

/** Shared by the open pixel and click redirect: 120 hits a minute per IP. */
export const trackingLimit = rateLimiter(120);

/**
 * Per-workspace limiter for the chat copilot and Server Actions (PR 18 hardening). Generous enough for
 * normal use, low enough to blunt a runaway client or a stolen session: 60 turns a minute per workspace.
 */
export const chatLimit = rateLimiter(60);

/** Per-IP limiter for the unauthenticated auth endpoints (sign-in, callbacks): 30 a minute. */
export const authLimit = rateLimiter(30);
