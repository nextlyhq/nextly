import { fileURLToPath } from "node:url";

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  // Template components are written for Next.js, which compiles JSX with the
  // automatic runtime and never imports React for it.
  esbuild: { jsx: "automatic" },
  resolve: {
    // Template code imports Nextly, which this package never installs: it only
    // writes those imports into the projects it scaffolds. A test that runs
    // template code gets the recording stub instead.
    alias: [
      {
        find: /^nextly(?:\/config|\/runtime|\/database\/seeders)?$/,
        replacement: fileURLToPath(
          new URL("./src/__tests__/stubs/nextly.ts", import.meta.url)
        ),
      },
      // The blog's search loads the Pagefind bundle its build generates;
      // tests get a stand-in whose searches answer when the test says.
      {
        find: /^\/pagefind\/pagefind\.js$/,
        replacement: fileURLToPath(
          new URL("./src/__tests__/stubs/pagefind.ts", import.meta.url)
        ),
      },
      // Template code sits outside this package, so a bare `react` import
      // from it would look for a node_modules beside the templates. Tests
      // that render it use this package's React, the one the test library
      // renders with.
      {
        find: /^(react|react-dom)(\/.*)?$/,
        replacement: `${fileURLToPath(new URL("./node_modules/", import.meta.url))}$1$2`,
      },
      // Blog template code imports its own source through `@/`, which a
      // scaffolded blog project's tsconfig maps to its `src`.
      {
        find: /^@\/(.*)$/,
        replacement: `${fileURLToPath(
          new URL("../../templates/blog/src/", import.meta.url)
        )}$1`,
      },
    ],
  },
  test: {
    // What each file loaded on its last run, so `--changed` and `related` pick
    // tests from real dependencies rather than a static import graph.
    experimental: { recordDependencies: true },
    name: "create-nextly-app",
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    exclude: ["node_modules", "dist", ".turbo", "**/*.d.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/index.ts",
      ],
    },
    testTimeout: 10000,
  },
});
