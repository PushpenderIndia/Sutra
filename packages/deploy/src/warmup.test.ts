import { describe, expect, it } from 'vitest';
import { healthTargets, warmup } from './warmup.ts';

const noSleep = () => Promise.resolve();

/** A fetch stub that returns the given statuses in order (repeating the last). */
function statusFetch(...statuses: number[]): typeof fetch {
  let i = 0;
  return () => {
    const status = statuses[Math.min(i++, statuses.length - 1)] ?? 200;
    return Promise.resolve(new Response(null, { status }));
  };
}

const target = { name: 'web', url: 'https://sutra.example/healthz' };

describe('warmup', () => {
  it('reports ok on the first 2xx', async () => {
    const [r] = await warmup([target], { fetch: statusFetch(200), sleep: noSleep });
    expect(r).toMatchObject({ name: 'web', ok: true, status: 200, attempts: 1 });
  });

  it('retries until a service answers, then succeeds', async () => {
    const [r] = await warmup([target], {
      fetch: statusFetch(503, 503, 200),
      sleep: noSleep,
      attempts: 5,
    });
    expect(r?.ok).toBe(true);
    expect(r?.attempts).toBe(3);
  });

  it('gives up after `attempts` and records the last status', async () => {
    const [r] = await warmup([target], {
      fetch: statusFetch(500),
      sleep: noSleep,
      attempts: 3,
    });
    expect(r).toMatchObject({ ok: false, status: 500, attempts: 3 });
    expect(r?.error).toBe('HTTP 500');
  });

  it('captures a thrown network error', async () => {
    const failing: typeof fetch = () => Promise.reject(new Error('ECONNREFUSED'));
    const [r] = await warmup([target], { fetch: failing, sleep: noSleep, attempts: 2 });
    expect(r?.ok).toBe(false);
    expect(r?.error).toBe('ECONNREFUSED');
    expect(r?.attempts).toBe(2);
  });

  it('warms every target in parallel', async () => {
    const results = await warmup(
      [target, { name: 'litellm', url: 'https://llm.example/health/liveliness' }],
      { fetch: statusFetch(200), sleep: noSleep },
    );
    expect(results.map((r) => r.ok)).toEqual([true, true]);
  });
});

describe('healthTargets', () => {
  it('derives the two health endpoints from the base URLs', () => {
    expect(healthTargets('https://web.example/', 'https://llm.example')).toEqual([
      { name: 'sutra-web', url: 'https://web.example/healthz' },
      { name: 'sutra-litellm', url: 'https://llm.example/health/liveliness' },
    ]);
  });
});
