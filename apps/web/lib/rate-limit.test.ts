import { describe, expect, it } from 'vitest';
import { clientIp, rateLimiter } from './rate-limit';

describe('rateLimiter', () => {
  it('allows up to the limit in a window, then blocks', () => {
    const allow = rateLimiter(3, 1000);
    const now = 0;
    expect(allow('k', now)).toBe(true);
    expect(allow('k', now)).toBe(true);
    expect(allow('k', now)).toBe(true);
    expect(allow('k', now)).toBe(false); // 4th in the window
  });

  it('resets after the window', () => {
    const allow = rateLimiter(1, 1000);
    expect(allow('k', 0)).toBe(true);
    expect(allow('k', 500)).toBe(false);
    expect(allow('k', 1001)).toBe(true); // new window
  });

  it('tracks keys independently (per workspace / per IP)', () => {
    const allow = rateLimiter(1, 1000);
    expect(allow('a', 0)).toBe(true);
    expect(allow('b', 0)).toBe(true);
    expect(allow('a', 0)).toBe(false);
  });
});

describe('clientIp', () => {
  it('reads the first x-forwarded-for hop', () => {
    const req = new Request('https://x.test', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    });
    expect(clientIp(req)).toBe('1.2.3.4');
  });

  it('is null without the header', () => {
    expect(clientIp(new Request('https://x.test'))).toBeNull();
  });
});
