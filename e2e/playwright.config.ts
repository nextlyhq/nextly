import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

import { E2E_NEXTLY_SECRET } from "./tests/support/preview-links";

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

/**
 * Which server the suite runs against. `dev` (the default) is `pnpm dev:app`:
 * what a contributor runs, compiling each route on its first request.
 * `production` is the same playground built with `next build` and served by
 * `next start`, with the same database, secrets and e2e fixtures. It runs the
 * same specs about four times as fast, so CI runs the suite there, and runs the
 * specs below on `dev` by themselves (`E2E_DEV_SPECS_ONLY=1`).
 */
const SERVER = process.env.E2E_SERVER === "production" ? "production" : "dev";

/**
 * The specs that need the dev server, each for a reason a production build
 * removes rather than a difference to paper over:
 *
 * - `setup-*`: first-run setup's origin rules for loopback names hold in
 *   development only, and `next dev` is what serves those names a page.
 * - `component-map-dev`: a development server refusing a stale component map.
 * - The Schema Builder specs: a production build turns the builder off unless
 *   the app opts in, and refuses its writes with `BUILDER_DISABLED`.
 * - `media-urls`: a production server serves only the files `public/` held
 *   when it started, so an image uploaded during the run is not found there.
 */
const DEV_SPECS = [
  "**/setup-*.spec.ts",
  "**/component-map-dev.spec.ts",
  "**/schema-builder.spec.ts",
  "**/schema-leaving-translation.spec.ts",
  "**/builder-field-gates.spec.ts",
  "**/builder-runtime-collection.spec.ts",
  "**/media-urls.spec.ts",
];

/** Only the dev specs, for the run beside a production one. */
const DEV_SPECS_ONLY =
  SERVER === "dev" && process.env.E2E_DEV_SPECS_ONLY === "1";

/**
 * Where a run writes its results and report. The dev specs' run has its own,
 * since Playwright empties its results folder as it starts, and a shared one
 * would lose the production run's traces and screenshots beside it.
 */
const RUN_OUTPUT = DEV_SPECS_ONLY ? "dev-specs" : "suite";

/**
 * The commands that start each server, after the database is emptied.
 *
 * The dev server applies the schema to the empty database on boot. A
 * production server does not, so the seed and the plugin install run first, as
 * the production suite's config does. `E2E_PRODUCTION_PREBUILT=1` skips the
 * build, for a caller that built once and runs the suite several times on it.
 */
const START = {
  dev: ["pnpm dev:app"],
  production: [
    "pnpm --filter playground exec tsx scripts/seed.ts",
    "pnpm --filter playground exec nextly plugins install --all",
    ...(process.env.E2E_PRODUCTION_PREBUILT === "1"
      ? []
      : ["pnpm --filter playground exec next build"]),
    "pnpm --filter playground exec next start",
  ],
}[SERVER];

export default defineConfig({
  testDir: "./tests",
  /*
   * `tests/production` belongs to the OTHER config and must not run here.
   *
   * Those specs drive a production build: they sign in through the real form
   * and assert what a visitor is served. This config runs `pnpm dev:app`, where
   * `admin.devAutoLogin` puts the browser on the dashboard already signed in —
   * so the sign-in form never renders and the spec fails waiting for an input
   * that a production build would have shown it.
   *
   * The default `testDir` walks subdirectories, so a spec placed under `tests/`
   * is picked up by this config whether or not it was written for it. Excluding
   * by path is what keeps "which server does this suite need" a property of the
   * directory rather than something each spec has to survive.
   */
  testIgnore: [
    "**/production/**",
    ...(SERVER === "production" ? DEV_SPECS : []),
  ],
  ...(DEV_SPECS_ONLY ? { testMatch: DEV_SPECS } : {}),
  outputDir: `./.playwright/results/${RUN_OUTPUT}`,

  // A failing assertion in a shared admin is usually a real failure, so the
  // suite is not retried into passing locally. CI retries once, for the
  // genuinely slow-machine flakes, and records a trace when it does.
  retries: process.env.CI ? 1 : 0,
  // A run whose server broke fails every remaining test the same way, each one
  // waiting out its timeout twice: past this many failures the rest of the
  // report adds nothing but minutes on a runner. A green run still needs every
  // test, so this only shortens a run that has already failed.
  maxFailures: process.env.CI ? 25 : 0,
  // Two workers on a production server and one on `dev`. Measured on the CI
  // runner: a second worker made each test about a quarter slower on a
  // production server and finished the run a third sooner, while on `dev`,
  // where compiling routes already takes the runner's CPU, each test took
  // about twice as long for little gain. Every worker shares the one server and
  // the one database, so a spec that writes shared state, or reads it as a
  // whole, takes that state's named lock (`tests/support/locks.ts`), and files
  // holding the same lock never overlap. Each file signs in as an account of
  // its own (`tests/support/test`). `fullyParallel: false` keeps each file's
  // tests in order on one worker.
  workers: SERVER === "production" ? 2 : 1,
  // A retry runs ALONE, after everything else, rather than beside another
  // file. A test that fails only next to another one then passes on its
  // retry and is reported flaky, which names the coupling, instead of failing
  // twice for a reason that is not its own.
  retryStrategy: "isolated",
  forbidOnly: !!process.env.CI,
  fullyParallel: false,

  // `flaky-reporter` records which tests passed only on a RETRY. It emits no
  // annotation: the `github` reporter beside it already reports a flaky test,
  // and two annotations for one event at different severities read worse than
  // one. This adds the job-summary section and the count, so the SET is
  // answerable across runs — the retry is Playwright's own, so `run_attempt`
  // stays 1 and nothing at the workflow level distinguishes it.
  reporter: process.env.CI
    ? [
        ["github"],
        ["./flaky-reporter.ts"],
        [
          "html",
          { outputFolder: `./.playwright/report/${RUN_OUTPUT}`, open: "never" },
        ],
      ]
    : [
        ["list"],
        [
          "html",
          { outputFolder: `./.playwright/report/${RUN_OUTPUT}`, open: "never" },
        ],
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
      // Each file's session comes from `tests/support/test`, which signs in
      // an account of its own for it.
      use: devices["Desktop Chrome"],
    },
  ],

  webServer: {
    // The reset runs here rather than in globalSetup because globalSetup runs
    // *after* the server is up, by which point the file it would delete is
    // open. The dev server, not a production build: it is what a contributor
    // runs, and it applies the schema to the empty database on boot, which is
    // how the throwaway file becomes usable without a separate push step.
    command: ["node e2e/scripts/reset-e2e-db.mjs", ...START].join(" && "),
    cwd: NEXTLY_ROOT,
    url: `${BASE_URL}/api/health`,
    // Generous: a cold Next.js dev boot compiles the admin on first request,
    // and CI machines are slower than the laptop this was written on. A
    // production server that builds first needs the build's time as well.
    timeout:
      SERVER === "production" && process.env.E2E_PRODUCTION_PREBUILT !== "1"
        ? 15 * 60 * 1000
        : 240 * 1000,
    // Never reuse: a server already on this port is running against a
    // database this suite has not emptied, and the whole safety story is that
    // it has.
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PORT: String(PORT),
      // A known signing secret, so share-preview-links.spec.ts can sign a link
      // as an earlier version minted it. It wins over the playground's `.env`.
      NEXTLY_SECRET: E2E_NEXTLY_SECRET,
      DB_DIALECT: "sqlite",
      DATABASE_URL: E2E_DB_RELATIVE,
      // Its own build directory. A separate port is not enough on its own:
      // two `next dev` processes on one app fight over `.next`, and the
      // second dies before it serves anything. With this, the suite runs
      // while a contributor's dev server keeps going on 3000.
      NEXT_DIST_DIR: SERVER === "production" ? ".next-e2e-start" : ".next-e2e",
      // Turns on the playground's brand colors, which admin-branding.spec.ts
      // asserts against. They are off by default so a contributor's admin
      // keeps the monochrome identity a default install has.
      NEXTLY_E2E_BRANDING: "1",
      // Registers the style fixture, which plugin-admin-styling.spec.ts and
      // plugin-page-routing.spec.ts both depend on. Off by default so a test
      // double does not appear in a contributor's plugins list or inject a
      // showcase section into the Posts collection.
      NEXTLY_E2E_STYLE_FIXTURE: "1",
      // Registers the slow-card fixture, which dashboard-slow-card.spec.ts
      // delays. Its card answers at once until that spec asks otherwise, so the
      // other dashboard specs see an ordinary card.
      NEXTLY_E2E_SLOW_WIDGET: "1",
      // The builder-shell harness route, gated the same way and for the same
      // reason: a dev-only route under `src/app/` is otherwise reachable in
      // `pnpm dev:app` and indistinguishable from product.
      NEXTLY_E2E_SHELL_HARNESS: "1",
      // The canvas harness route. Separate from the shell's because the two
      // harnesses are deliberately different: the shell's slots are inert
      // markers, and this one mounts the real canvas so a pointer can drive it.
      NEXTLY_E2E_CANVAS_HARNESS: "1",
      // The running app never rewrites generated files. The fixtures above add
      // components the committed component map was not generated with, and
      // `next dev` would otherwise write the map again, leaving the checkout
      // changed after every run.
      NEXTLY_GENERATED_FILES_WRITE: "0",
      // `next start` refuses to boot without the app's own address, which the
      // dev server never needed.
      NEXT_PUBLIC_APP_URL: BASE_URL,
    },
  },

  globalSetup: "./global-setup.ts",
});
