/** @type {import('next').NextConfig} */

const nextConfig = {
  output: 'standalone',
  // Pin tracing root to the project to avoid monorepo lockfile warnings
  outputFileTracingRoot: __dirname,
  // eslint: {
  //   dirs: ['src'],
  // },

  reactStrictMode: true,

  // Proxy routes to Go server.
  // Note: Next.js loads rewrites at build time, so runtime env toggles may not apply.
  // Default to enabled (can be disabled explicitly via ENABLE_GO_PROXY=false).
  // Proxy routes to Go server.
  // REMOVED: Next.js rewrites cause [DEP0060] DeprecationWarning (util._extend).
  // We now rely on the Node.js Route Handlers in src/app/api/proxy/[type]/route.ts
  // async rewrites() { ... }

  // Uncoment to add domain whitelist
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },

  webpack(config) {
    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg'),
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: { not: /\.(css|scss|sass)$/ },
        resourceQuery: { not: /url/ }, // exclude if *.svg?url
        loader: '@svgr/webpack',
        options: {
          dimensions: false,
          titleProp: true,
        },
      },
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      crypto: false,
    };

    return config;
  },
};

// const withPWA = require('next-pwa')({
//   dest: 'public',
//   disable: process.env.NODE_ENV === 'development',
//   register: true,
//   skipWaiting: true,
// });

// module.exports = withPWA(nextConfig);
module.exports = nextConfig;
