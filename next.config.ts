import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Staging demonstration builds are never indexed (lib/platform/staging.ts). No effect otherwise.
  async headers() {
    return String(process.env.STAGING_DEMO_MODE || '').toLowerCase() === 'true'
      ? [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }] }]
      : [];
  },
};

export default nextConfig;
