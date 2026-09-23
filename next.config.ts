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
};

export default nextConfig;
