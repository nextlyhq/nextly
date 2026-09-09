import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    /*
     * Sized for an instance boot, because that is what this suite does.
     *
     * `plugin.test.ts` calls `createTestNextly` in `beforeEach`, which builds a
     * DI container, registers the plugin's schema and runs auto-sync against a
     * real SQLite database. Vitest's defaults are sized for a unit test that
     * touches none of that: 5s for a case and 10s for a hook. A boot is about a
     * second and a half on a warm machine, and the first run of a freshly
     * scaffolded project is the least warm moment there is - a cold install, no
     * build cache, whatever the laptop or CI container is doing.
     *
     * This is the first command a new plugin author runs, so a timeout here
     * reads as "the scaffold ships a broken test" rather than "the budget was
     * tight". The monorepo solves the same problem by routing boots to a lane
     * with a 30s budget; a single-package project has one lane and nothing to
     * contend with, so it states the budget instead.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
