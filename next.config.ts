import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // The loader is spawned, not bundled. Include its files and mysql2's complete
  // runtime dependency closure explicitly (checked against package-lock in tests).
  outputFileTracingIncludes: {
    '/*': [
      './scripts/existing-tenant-load.mjs', './scripts/existing-tenant-verify.mjs',
      './scripts/import-demo-tenant.mjs', './scripts/live-tenant-inventory.mjs',
      './scripts/mysql-config.mjs', './scripts/demo/**/*.mjs',
      './lib/platform/maintenance-policy.mjs', './lib/platform/staging-policy.mjs',
      './docs/DEMO-COMPANY-MANIFEST.json', './docs/DEMO-IMPORT-FOOTPRINT.json',
      ...['mysql2', 'aws-ssl-profiles', 'generate-function', 'is-property',
        'iconv-lite', 'safer-buffer', 'long', 'lru.min', 'named-placeholders',
        'sql-escaper'].map(name => `./node_modules/${name}/**/*`),
    ],
  },
  // Staging demonstration builds are never indexed (lib/platform/staging.ts). No effect otherwise.
  async headers() {
    return String(process.env.STAGING_DEMO_MODE || '').toLowerCase() === 'true'
      ? [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }] }]
      : [];
  },
};

export default nextConfig;
