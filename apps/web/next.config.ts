import { publicEnv } from '@sutra/config/next';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
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
