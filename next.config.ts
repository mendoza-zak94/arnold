import type { NextConfig } from 'next';

/**
 * There is almost no browser surface here - one status page and three API
 * routes - so the build stays deliberately boring.
 */
const config: NextConfig = {
  reactStrictMode: true,
};

export default config;
