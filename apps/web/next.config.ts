import { publicEnv } from '@sutra/config/next';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@sutra/*'],
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

export default nextConfig;
