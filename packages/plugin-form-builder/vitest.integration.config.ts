// Integration config for the form-builder plugin. Runs only
// `*.integration.test.ts`.
//
// Mirrors the split in `nextly`, `plugin-page-builder` and `plugin-seo`: these
// boot a real Nextly instance per test and exercise the plugin's own
// collections against it, so they need a budget a unit default cannot give them
// and they must not compete with the parallel unit step for the runner.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "plugin-form-builder-integration",
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // A real instance boot per test, so the unit default is far too tight.
    // Kept at the value the unit config used to carry, which was sized for this
    // work — what changes is that it is no longer paid while every other
    // package's suite runs beside it.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each test boots its own instance against a shared in-memory database, so
    // the files cannot safely interleave.
    fileParallelism: false,
  },
});
