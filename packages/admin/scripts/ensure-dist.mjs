#!/usr/bin/env node

/**
 * ensure-dist.mjs — Build the package when its dist is missing.
 *
 * The bundle-report suite measures the REAL built dist, and the test task's
 * turbo dependencies build only the workspace's dependencies (`^build`), not
 * this package — so on a fresh checkout the dist is absent and the real-dist
 * test would throw before any assertion. This script runs ahead of vitest and
 * builds once when the dist is missing; a present dist is measured as it
 * stands, which is the point of the test.
 */

import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(PACKAGE_ROOT, "dist", "index.mjs");

if (existsSync(DIST_ENTRY)) {
  process.exit(0);
}

console.error(
  "[ensure-dist] dist/index.mjs not found — building @nextlyhq/admin before the tests that measure it..."
);
execSync("pnpm build", { cwd: PACKAGE_ROOT, stdio: "inherit" });
