import { publicEnv } from '@sutra/config/next';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  transpilePackages: ['@sutra/*'],
  // ADK (via @sutra/agents, server only) loads optional drivers at run time; don't bundle it.
  serverExternalPackages: ['@google/adk'],
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
