import { join } from 'node:path';
import { publicEnv } from '@sutra/config/next';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Content-Security-Policy and the companion security headers (PR 18 hardening). Scripts and styles are
 * same-origin; `'unsafe-inline'` covers Next's hydration/runtime inline bundles and Tailwind's inline
 * styles. `connect-src` allows the Google APIs the app calls (OAuth, Gmail/Calendar, Maps). Framing is
 * denied and the referrer is trimmed. Tightening to nonces is a follow-up.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' https://*.googleapis.com https://accounts.google.com",
  "form-action 'self'",
  "frame-src 'self' https://accounts.google.com",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig: NextConfig = {
  // Cloud Run runs the traced standalone server (infra/docker/web.Dockerfile). The tracing root is
  // the monorepo root, two levels up, so workspace packages are bundled into .next/standalone.
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  transpilePackages: ['@sutra/*'],
  // Server-only SDKs (via @sutra/agents) kept out of the bundle: the ADK lazily `require()`s
  // optional ORM drivers (e.g. @mikro-orm/sqlite) we don't use, which the bundler cannot resolve;
  // @google/genai (profiler web research) is externalised for the same reason.
  serverExternalPackages: ['@google/adk', '@google/genai'],
  env: publicEnv(),
  cacheComponents: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default createNextIntlPlugin('./i18n/request.ts')(nextConfig);
