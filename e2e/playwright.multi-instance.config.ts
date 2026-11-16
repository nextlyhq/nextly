import { defineConfig } from "@playwright/test";

/**
 * Two production instances of one site on one Postgres database, sharing
 * Nextly's cache handlers. No browser and no `webServer`: each leg builds its
 * own fixture app and starts its own two servers (`multi-instance/instances.ts`),
 * since the legs differ in what they are built with.
 *
 * Needs `MULTI_INSTANCE_DATABASE_URL`, an empty Postgres test database that
 * each leg empties again, and the packages built.
 *
 * @module playwright.multi-instance.config
 */
export default defineConfig({
  testDir: "./multi-instance",
  // The fixture's copies hold Next.js's own type files; only the spec is a test.
  testMatch: "*.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  // Its own report folder, as each suite here has, so a CI run uploads this
  // suite's report and not whichever suite finished last.
  reporter: process.env.CI
    ? [
        ["github"],
        ["line"],
        [
          "html",
          {
            outputFolder: "./.playwright/report-multi-instance",
            open: "never",
          },
        ],
      ]
    : [["line"]],
  outputDir: "./.playwright/results-multi-instance",
  timeout: 2 * 60_000,
});
