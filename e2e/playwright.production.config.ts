import { defineConfig, devices } from "@playwright/test";

import {
  BASE_URL,
  NEXTLY_ROOT,
  PORT,
  productionServerEnv,
} from "./production-server";

/**
 * The only suite here that runs a PRODUCTION build.
 *
 * A separate config rather than a project inside the dev one, because the two
 * cannot share a `webServer`: this needs `next build` before `next start`, and
 * the difference is the entire point. A production build resolves modules,
 * bundles and prerenders differently enough that a route can answer 500 on
 * every path there while serving correctly under `next dev` — so a suite that
 * boots the dev server certifies the one environment in which that class of
 * failure cannot appear.
 *
 * Dev auto-login is correctly hard-blocked here, so the spec signs in through
 * the real form with the seeded credentials. That is not incidental: a suite
 * that authenticated by a dev-only shortcut would prove a path no visitor or
 * editor ever takes.
 *
 * @module playwright.production.config
 */
export default defineConfig({
  testDir: "./tests/production",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  // The HTML reporter is what makes the CI artifact exist. With `github` and
  // `line` alone the run annotates and prints, writes no report directory, and
  // an upload step finds nothing — which is worst on the failing run that most
  // needs the trace. Its own folder rather than the dev suite's, for the reason
  // the port and the database are its own: on one machine a shared folder
  // leaves whichever suite finished last as the only report either has.
  reporter: process.env.CI
    ? [
        ["github"],
        ["line"],
        [
          "html",
          { outputFolder: "./.playwright/report-production", open: "never" },
        ],
      ]
    : [["line"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // Reset, then seed, then install, then BUILD, then serve. The seed runs
    // against the same database the built server will open, and it is what
    // creates the user this suite signs in as — there is no dev auto-login to
    // fall back on. A production boot refuses a configured plugin that
    // `nextly plugins install` has not recorded on the database, so each plugin
    // the playground configures is installed, as a deployment would, before
    // the server starts. The script reads which plugins those are from the
    // playground's config, so one added there is installed here too.
    command: [
      "node e2e/scripts/reset-e2e-db.mjs",
      "pnpm --filter playground exec tsx scripts/seed.ts",
      "pnpm --filter playground exec tsx scripts/install-plugins.ts",
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
    env: productionServerEnv(PORT),
  },
});
