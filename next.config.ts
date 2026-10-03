import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  // TikTok defines a URL-prefix property with a trailing slash and rejects
  // HTTP 3xx responses. Next.js normally turns `/terms-of-service/` into a
  // 308 to `/terms-of-service`, even though the former is the exact URL shown
  // in the TikTok Developers console. Serve both spellings directly instead;
  // internal links still use the canonical trailing-slash legal URLs below.
  skipTrailingSlashRedirect: true,
  // Prisma's pg driver is Node-only. Externalizing it keeps node:fs/path/stream
  // out of non-Node webpack compilation while standalone tracing still copies
  // the packages into the production server bundle.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  // typedRoutes is intentionally disabled: the sidebar references planned
  // routes (Produtos, Creators, Campanhas, Analytics) that ship in later PRs.
  typedRoutes: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  env: {
    // A Sentry DSN identifies a project but is not a credential; the client
    // SDK needs it to report browser exceptions when server reporting is on.
    NEXT_PUBLIC_SENTRY_DSN: process.env.SENTRY_DSN,
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT,
  },
};

export default nextConfig;
