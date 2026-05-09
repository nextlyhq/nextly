import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "nextly",
    "@nextlyhq/adapter-drizzle",
    "@nextlyhq/adapter-postgres",
    "@nextlyhq/adapter-mysql",
    "@nextlyhq/adapter-sqlite",
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
