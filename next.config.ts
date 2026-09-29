import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
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
