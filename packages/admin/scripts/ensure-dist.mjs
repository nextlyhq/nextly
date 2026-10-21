#!/usr/bin/env node

/**
 * ensure-dist.mjs — Build the package when its dist is missing or partial.
 *
 * The bundle-report suite measures the REAL built dist, and the test task's
 * turbo dependencies build only the workspace's dependencies (`^build`), not
 * this package — so on a fresh checkout the dist is absent and the real-dist
 * test would throw before any assertion. Under turbo the package-scoped
 * `packages/admin/turbo.json` puts this package's own `build` ahead of its
 * tests in the task graph, so this script is a no-op there; it exists for a
 * direct `pnpm --filter @nextlyhq/admin test` outside turbo.
 *
 * The build is this package's own, never the workspace's: turbo may be
 * running other packages' tests against `nextly`'s dist concurrently, and a
 * nested rebuild of a dependency would pull that ground out from under them.
 * A direct run on a checkout that has NO dependency dists fails admin's build
 * naming the resolution it missed — run it through turbo instead, which
 * builds the dependencies first.
 *
 * "Present" means complete: every entrypoint the package declares must be in
 * the dist, not only index.mjs — an interrupted build can leave the entry
 * without the rest, and a suite that measured that would report over a
 * package nobody can install.
 */

import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DECLARED_BROWSER_ENTRIES } from "./bundle-report.mjs";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const missing = [...DECLARED_BROWSER_ENTRIES].filter(
  rel => !existsSync(join(PACKAGE_ROOT, "dist", rel))
);

if (missing.length === 0) {
  process.exit(0);
}

console.error(
  `[ensure-dist] dist is missing or partial — no ${missing.join(", ")} — building @nextlyhq/admin before the tests that measure it...`
);
execSync("pnpm build", { cwd: PACKAGE_ROOT, stdio: "inherit" });
