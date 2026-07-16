import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NEXTLY_ROOT = path.resolve(HERE, "..");

/**
 * Not 3000. A contributor almost always has the playground running there
 * already, and pointing the suite at it would run destructive tests against
 * the database they are working in. 3001 is taken often enough to matter too.
 */
const PORT = Number(process.env.E2E_PORT) || 3100;

/**
 * `localhost`, not `127.0.0.1`, and the difference is not cosmetic: the
 * playground's dev auto-login issues no session for `127.0.0.1`, so the admin
 * renders an empty shell forever and every test times out looking for a screen
 * that is waiting to know who you are. `localhost` is also what a contributor
 * types, so the suite exercises the same origin they do.
 */
const BASE_URL = `http://localhost:${PORT}`;

/**
 * The suite's own database, never the one `pnpm dev:app` uses.
 *
 * A shell `DATABASE_URL` wins over the playground's `.env`, so the server can
 * be pointed at a throwaway file. That is what makes a test allowed to delete
 * things: there is nothing here anyone wanted. Relative because the playground
 * resolves it from its own directory.
 */
const E2E_DB_RELATIVE = "file:./data/e2e.db";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./.playwright/results",

  // A failing assertion in a shared admin is usually a real failure, so the
  // suite is not retried into passing locally. CI retries once, for the
  // genuinely slow-machine flakes, and records a trace when it does.
  retries: process.env.CI ? 1 : 0,
  // One worker, everywhere. `fullyParallel: false` only serialises tests
  // *within* a file; different spec files still get their own worker, and the
  // default is more than one on most machines. Every worker here would share
  // the same database and the same signed-in session, so a field one file
  // creates is visible to another mid-assertion. The suite runs in ~20s: there
  // is nothing to win by racing it against itself.
  workers: 1,
  forbidOnly: !!process.env.CI,
  fullyParallel: false,

  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { outputFolder: "./.playwright/report", open: "never" }],
      ]
    : [
        ["list"],
        ["html", { outputFolder: "./.playwright/report", open: "never" }],
      ],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Signed in before the first test, by global-setup.
        storageState: "./.playwright/session.json",
      },
    },
  ],

  webServer: {
    // The reset runs here rather than in globalSetup because globalSetup runs
    // *after* the server is up, by which point the file it would delete is
    // open. The dev server, not a production build: it is what a contributor
    // runs, and it applies the schema to the empty database on boot, which is
    // how the throwaway file becomes usable without a separate push step.
    command: "node e2e/scripts/reset-e2e-db.mjs && pnpm dev:app",
    cwd: NEXTLY_ROOT,
    url: `${BASE_URL}/api/health`,
    // Generous: a cold Next.js dev boot compiles the admin on first request,
    // and CI machines are slower than the laptop this was written on.
    timeout: 240 * 1000,
    // Never reuse: a server already on this port is running against a
    // database this suite has not emptied, and the whole safety story is that
    // it has.
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PORT: String(PORT),
      DB_DIALECT: "sqlite",
      DATABASE_URL: E2E_DB_RELATIVE,
      // Its own build directory. A separate port is not enough on its own:
      // two `next dev` processes on one app fight over `.next`, and the
      // second dies before it serves anything. With this, the suite runs
      // while a contributor's dev server keeps going on 3000.
      NEXT_DIST_DIR: ".next-e2e",
    },
  },

  globalSetup: "./global-setup.ts",
});
