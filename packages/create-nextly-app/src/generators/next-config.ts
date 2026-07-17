import path from "path";

import fs from "fs-extra";

import type { DatabaseConfig } from "../types";

/**
 * Packages that are always externalized by the scaffolded Next.js config.
 *
 * These packages are used by Nextly at runtime and should stay out of the
 * server bundle regardless of the selected database.
 */
const COMMON_SERVER_EXTERNAL_PACKAGES = [
  "nextly",
  "@nextlyhq/adapter-drizzle",
  "drizzle-orm",
  "drizzle-kit",
  "bcryptjs",
  "sharp",
  "esbuild",
];

/**
 * Database-specific packages needed by the selected adapter.
 */
const DATABASE_SERVER_EXTERNAL_PACKAGES: Record<
  DatabaseConfig["type"],
  string[]
> = {
  postgresql: ["@nextlyhq/adapter-postgres", "pg"],
  mysql: ["@nextlyhq/adapter-mysql", "mysql2"],
  sqlite: ["@nextlyhq/adapter-sqlite", "better-sqlite3"],
};

/**
 * Build the exact list of packages that should be externalized for a chosen
 * database.
 */
export function getServerExternalPackages(database: DatabaseConfig): string[] {
  return [
    ...COMMON_SERVER_EXTERNAL_PACKAGES,
    ...DATABASE_SERVER_EXTERNAL_PACKAGES[database.type],
  ];
}

/**
 * Render a complete next.config.ts file for the selected database.
 */
export function buildNextConfigTemplate(database: DatabaseConfig): string {
  const packagesArray = JSON.stringify(
    getServerExternalPackages(database),
    null,
    2
  ).replace(/\n/g, "\n  ");

  return `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ${packagesArray},

  // Configure Next.js Image to accept local uploads in development.
  // For production, add your deployed domain to remotePatterns.
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        pathname: "/uploads/**",
      },
      {
      protocol: "http",
      hostname: "127.0.0.1",
      pathname: "/uploads/**",
      },

    ],
  },
};

export default nextConfig;
`;
}

/**
 * Patch the project's next.config file to include serverExternalPackages.
 *
 * Handles both .ts and .mjs config files. If the config already contains
 * serverExternalPackages the file is left untouched.
 */
export async function patchNextConfig(
  cwd: string,
  database: DatabaseConfig
): Promise<void> {
  // Find the next.config file
  const candidates = ["next.config.ts", "next.config.mjs", "next.config.js"];

  let configPath: string | null = null;
  for (const name of candidates) {
    const full = path.join(cwd, name);
    if (await fs.pathExists(full)) {
      configPath = full;
      break;
    }
  }

  if (!configPath) {
    // No next.config found — nothing to patch
    return;
  }

  const content = await fs.readFile(configPath, "utf-8");

  // Skip if already configured
  if (content.includes("serverExternalPackages")) {
    return;
  }

  const packagesArray = JSON.stringify(
    getServerExternalPackages(database),
    null,
    2
  )
    // Indent each line by 2 extra spaces so it sits inside the config object
    .replace(/\n/g, "\n  ");

  // Try to inject into the NextConfig object.
  // Match patterns like `const nextConfig: NextConfig = {` or `module.exports = {`
  // and insert serverExternalPackages as the first property.
  const configObjectPattern = /(const\s+\w+\s*(?::\s*NextConfig\s*)?=\s*\{)/;

  if (configObjectPattern.test(content)) {
    const patched = content.replace(
      configObjectPattern,
      `$1\n  serverExternalPackages: ${packagesArray},`
    );
    await fs.writeFile(configPath, patched, "utf-8");
    return;
  }

  // Fallback: try export default { pattern
  const exportDefaultPattern = /(export\s+default\s*\{)/;
  if (exportDefaultPattern.test(content)) {
    const patched = content.replace(
      exportDefaultPattern,
      `$1\n  serverExternalPackages: ${packagesArray},`
    );
    await fs.writeFile(configPath, patched, "utf-8");
    return;
  }

  // Could not patch automatically — leave unchanged
}
