import type { NextConfig } from "next";

/**
 * Minimal base `next.config.ts` for bundled templates.
 *
 * This file is intentionally left minimal (no adapter whitelist). The
 * scaffolder will generate or patch a database-specific `next.config.ts`
 * that includes only the selected adapter and driver in
 * `serverExternalPackages`. Keeping the base file minimal avoids
 * advertising adapters the user didn't choose and prevents misleading
 * generated projects.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
