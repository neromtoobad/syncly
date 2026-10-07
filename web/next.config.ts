import type { NextConfig } from 'next';

// The Hono API (server/) owns quotes, orders, SSE and the books. Next proxies /api to it.
const API = process.env.OUTLAY_API_URL ?? 'http://localhost:8790';

const config: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  compress: false, // keep Server-Sent Events from being buffered through the proxy
  images: { unoptimized: true },
  // The office art and sprites change rarely: browsers keep them a day and refresh them in the background after that.
  async headers() {
    const keep = [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }];
    // Every page: no framing by other sites (the books and pay pages act on clicks), links to other sites carry only
    // our origin (never a job's ?k= key), HTTPS only, and no MIME sniffing.
    // (The API and customer sites keep their own policies, so the frame rules are set on the app's pages only.)
    const safe = [
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
    ];
    const frames = [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
    ];
    return [{ source: '/:path*', headers: safe }, { source: '/((?!api/|s/).*)', headers: frames }, { source: '/sprites/:path*', headers: keep }, { source: '/scene/:path*', headers: keep }];
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API}/api/:path*` },
      // Sites the team builds for customers, served by the API from the books volume.
      { source: '/s/:slug', destination: `${API}/s/:slug/` },
      { source: '/s/:slug/:file*', destination: `${API}/s/:slug/:file*` },
    ];
  },
};
export default config;
