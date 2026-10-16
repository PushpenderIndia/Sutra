import { vi } from 'vitest';
import { request } from './request';

// Server Actions read the request from `next/headers`; tests set it with `as()`.
vi.mock('next/headers', () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));
