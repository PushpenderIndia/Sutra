import { describe, expect, it } from 'vitest';
import { GET, HEAD } from '@/app/healthz/route';

describe('healthz', () => {
  it('answers 200 with a status body and no caching (the warmup / liveness probe)', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { status: string; service: string; time: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('sutra-web');
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });

  it('HEAD is the same public probe', () => {
    expect(HEAD).toBe(GET);
  });
});
