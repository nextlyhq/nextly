import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NEXTLY_ROOT = path.resolve(HERE, "..");

/**
 * Its own port and its own database file, so this can run beside the dev suite
 * without either emptying the other's data underneath it.
 */
const PORT = Number(process.env.E2E_PROD_PORT) || 3101;
const BASE_URL = `http://localhost:${PORT}`;
const E2E_DB_RELATIVE = "file:./data/e2e-prod.db";

/**
 * The phase's exit demo, and the only suite here that runs a PRODUCTION build.
 *
 * A separate config rather than a project inside the dev one, because the two
 * cannot share a `webServer`: this needs `next build` before `next start`, and
 * the difference is the entire point. Task 179's 500-on-every-path reproduced
 * only in a production build and never in `next dev`, so a suite that boots the
 * dev server certifies the phase's exit criterion against the one environment
 * the failure could not appear in.
 *
 * Dev auto-login is correctly hard-blocked here, so the spec signs in through
 * the real form with the seeded credentials. That is not incidental — an exit
 * demo that authenticated by a dev-only shortcut would prove a path no visitor
 * or editor ever takes.
 *
 * @module playwright.production.config
 */
export default defineConfig({
  testDir: "./tests/production",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["line"]] : [["line"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // Reset, then seed, then BUILD, then serve. The seed runs against the same
    // database the built server will open, and it is what creates the user this
    // suite signs in as — there is no dev auto-login to fall back on.
    command: [
      "node e2e/scripts/reset-e2e-db.mjs",
      "pnpm --filter playground exec tsx scripts/seed.ts",
      "pnpm --filter playground exec next build",
      "pnpm --filter playground exec next start",
    ].join(" && "),
    cwd: NEXTLY_ROOT,
    url: `${BASE_URL}/api/health`,
    // A production build is minutes, not seconds, and this budget covers the
    // build as well as the boot because they share one command.
    timeout: 15 * 60 * 1000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PORT: String(PORT),
      DB_DIALECT: "sqlite",
      DATABASE_URL: E2E_DB_RELATIVE,
      // Its own build directory, for the same reason the dev suite has one: two
      // Next processes on one app fight over `.next`.
      NEXT_DIST_DIR: ".next-e2e-prod",
      // Production REQUIRES both of these and refuses to boot without them —
      // `env.ts` rejects a missing or under-32-character `NEXTLY_SECRET` and a
      // missing `NEXT_PUBLIC_APP_URL` only when NODE_ENV is production, which is
      // why `pnpm dev:app` never needed them. A fresh checkout also has no
      // `.env` (the dev script writes one; `next build` does not), so stating
      // them here is what makes this suite runnable from a clean clone.
      //
      // A literal test secret, not a generated one: a value that changed per run
      // would re-key everything derived from it and make a failure depend on
      // which run produced the database.
      NEXTLY_SECRET:
        "e2e-production-exit-demo-secret-not-a-real-deployment-key",
      NEXT_PUBLIC_APP_URL: BASE_URL,
      // NO harness routes. The dev suite enables them; this one must not, because
      // the demo's claim is about what a VISITOR is served, and a dev-only route
      // reachable in the build under test would falsify exactly that.
    },
  },
});
