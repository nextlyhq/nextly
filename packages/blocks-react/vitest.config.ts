import { defineConfig } from "vitest/config";

/**
 * The suite is static analysis over source files, not rendering.
 *
 * `node` rather than a DOM environment because nothing here mounts a
 * component: the layering checks read files and walk the import graph, and a
 * DOM environment would add startup cost for capability none of them use. When
 * renderer tests arrive they will need `jsdom`, and switching then is a
 * deliberate change rather than an inherited default.
 *
 * `.tsx` is included alongside `.ts` because blocks are React components and
 * their tests will live beside them.
 */

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Several suites assert against the BUILT declarations, and suites are
    // collected in parallel — so the build has to finish before collection
    // starts rather than inside any one suite's hook. See the setup file.
    globalSetup: ["./vitest.global-setup.ts"],
  },
});
