import { defineConfig } from "@playwright/test";

/**
 * The dev-reload check: a schema edit saved while the playground runs under
 * `next dev` reaches its database, on a port the dev server was given by `-p`
 * or by `PORT`.
 *
 * Kept apart from the main suite on purpose. Each case starts its own dev
 * server with the playground's dev-reload probe switched on, and then edits
 * that probe's source file. Run beside the main suite's server, the edit would
 * reload that server too, under specs that did not ask for it. So this config
 * has no `webServer`, runs one case at a time, and needs no browser: it reads
 * the database the server writes to.
 */
export default defineConfig({
  testDir: "./dev-reload",
  fullyParallel: false,
  workers: 1,
  // A cold `next dev` boot compiles the admin route before it can answer, and
  // CI machines are slower than a laptop.
  timeout: 8 * 60 * 1000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  outputDir: "./.playwright/results-dev-reload",
});
