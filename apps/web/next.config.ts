import type { NextConfig } from 'next';
import path from 'node:path';

// Forms post to the same site. Behind a forwarding proxy (GitHub Codespaces), the browser's address
// differs from the one the app sees, so those addresses are allowed here. Empty in production.
const allowedOrigins = (process.env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const config: NextConfig = {
  reactStrictMode: true,
  ...(allowedOrigins.length ? { experimental: { serverActions: { allowedOrigins } } } : {}),
  poweredByHeader: false,
  // The repo is a workspace; trace files from its root so `next build` finds shared packages.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // The about, privacy and terms pages read their Markdown at request time.
  outputFileTracingIncludes: { '/*': ['./content/**/*'] },
  // No server-side image resizing: nothing here needs it, and it keeps sharp out of the request path.
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
