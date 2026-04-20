import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@revnixhq/nextly",
    "@revnixhq/adapter-drizzle",
    "@revnixhq/adapter-postgres",
    "@revnixhq/adapter-mysql",
    "@revnixhq/adapter-sqlite",
    "drizzle-orm",
    "drizzle-kit",
    "pg",
    "mysql2",
    "better-sqlite3",
    "bcryptjs",
    "sharp",
    "esbuild",
  ],
};

export default nextConfig;
