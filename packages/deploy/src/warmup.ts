/**
 * Warms up the deployed services before a demo. Cloud Run runs at min instances 0, so the first
 * real request pays a cold start; `pnpm warmup` (run a minute before judging) hits each service's
 * health endpoint with a few retries so the instances are already up. Pure and fetch-injected, so
 * it is tested offline.
 */

export interface WarmupTarget {
  /** Human label for the log line. */
  name: string;
  /** Full health-check URL to hit. */
  url: string;
}

export interface WarmupResult extends WarmupTarget {
  ok: boolean;
  status?: number;
  attempts: number;
  error?: string;
}

export interface WarmupOptions {
  fetch?: typeof fetch;
  /** Max attempts per target before giving up (default 5). */
  attempts?: number;
  /** Per-request timeout in ms (default 10_000). */
  timeoutMs?: number;
  /** Base backoff between attempts in ms; doubles each retry (default 1_000). */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());

/** One target: retry until a 2xx or attempts run out. */
async function warmOne(target: WarmupTarget, opts: Required<WarmupOptions>): Promise<WarmupResult> {
  let lastError: string | undefined;
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await opts.fetch(target.url, { signal: controller.signal, redirect: 'manual' });
      lastStatus = res.status;
      if (res.ok) return { ...target, ok: true, status: res.status, attempts: attempt };
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < opts.attempts) await opts.sleep(opts.backoffMs * 2 ** (attempt - 1));
  }
  return {
    ...target,
    ok: false,
    status: lastStatus,
    attempts: opts.attempts,
    error: lastError,
  };
}

/** Warms every target in parallel and returns one result each. Never throws. */
export function warmup(
  targets: readonly WarmupTarget[],
  options: WarmupOptions = {},
): Promise<WarmupResult[]> {
  const opts: Required<WarmupOptions> = {
    fetch: options.fetch ?? fetch,
    attempts: options.attempts ?? 5,
    timeoutMs: options.timeoutMs ?? 10_000,
    backoffMs: options.backoffMs ?? 1_000,
    sleep: options.sleep ?? defaultSleep,
  };
  return Promise.all(targets.map((t) => warmOne(t, opts)));
}

/**
 * The health endpoints for the two Cloud Run services, from their base URLs: the web app's public
 * `/healthz` and the LiteLLM proxy's `/health/liveliness`.
 */
export function healthTargets(appUrl: string, litellmBaseUrl: string): WarmupTarget[] {
  const join = (base: string, path: string) => `${base.replace(/\/+$/, '')}${path}`;
  return [
    { name: 'sutra-web', url: join(appUrl, '/healthz') },
    { name: 'sutra-litellm', url: join(litellmBaseUrl, '/health/liveliness') },
  ];
}
