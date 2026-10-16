/**
 * Liveness probe. Public and dependency-free by design: `pnpm warmup` hits it a minute before
 * judging to wake the instance (Cloud Run min instances 0 means the first real request would
 * otherwise pay a cold start). Deliberately outside `app/api/` so it needs no session — the same
 * pattern the public tracking routes use. Kept cheap: no DB or LiteLLM call, so it can't flap.
 */
export function GET(): Response {
  return Response.json(
    { status: 'ok', service: 'sutra-web', time: new Date().toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export const HEAD = GET;
