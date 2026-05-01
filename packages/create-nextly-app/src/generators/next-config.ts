import path from "path";

import fs from "fs-extra";

/**
 * Database driver packages that must be listed in serverExternalPackages.
 *
 * These packages contain native binaries or are only used at runtime on the
 * server. Next.js webpack must skip bundling them so that:
 *   1. Missing optional drivers (e.g. mysql2 when using PostgreSQL) don't
 *      cause "Module not found" build errors.
 *   2. Native addons (better-sqlite3, pg-native) aren't processed by webpack.
 *   3. `bundle-require` (used by Nextly's CLI config-loader) does an
 *      internal `import(file)` that Turbopack's static analyzer rejects
 *      as "Cannot find module as expression is too dynamic". Marking it
 *      external makes Node load it directly, bypassing the analyzer.
 *      Without this, code-first HMR + boot-time apply fail silently with
 *      "Failed to load Nextly configuration."
 */
const SERVER_EXTERNAL_PACKAGES = [
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
  "bundle-require",
];

/**
 * Patch the project's next.config file to include serverExternalPackages.
 *
 * Handles both .ts and .mjs config files. If the config already contains
 * serverExternalPackages the file is left untouched.
 */
export async function patchNextConfig(cwd: string): Promise<void> {
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

  const packagesArray = JSON.stringify(SERVER_EXTERNAL_PACKAGES, null, 4)
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
