import { describe, expect, it } from 'vitest';
import { APP_NAME, TAGLINE } from './index.ts';

describe('@sutra/domain', () => {
  it('exports the product identity', () => {
    expect(APP_NAME).toBe('Sutra');
    expect(TAGLINE).toMatch(/thread/);
  });
});
