/** @type {import('next').NextConfig} */

const nextConfig = {
  output: 'standalone',
  // Pin tracing root to the project to avoid monorepo lockfile warnings
  outputFileTracingRoot: __dirname,
  // eslint: {
  //   dirs: ['src'],
  // },

  reactStrictMode: true,
  optimizeFonts: false,

  // Proxy routes to Go server running on port 8080
  async rewrites() {
    const goProxyUrl = process.env.GO_PROXY_URL || 'http://127.0.0.1:8080';
    return [
      {
        source: '/api/proxy/:path*',
        destination: `${goProxyUrl}/api/proxy/:path*`,
      },
      {
        source: '/api/image-proxy',
        destination: `${goProxyUrl}/api/image-proxy`,
      },
    ];
  },

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
      rule.test?.test?.('.svg')
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
      }
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

const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
});

module.exports = withPWA(nextConfig);
