import { fileURLToPath } from "node:url";

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
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
    ],
  },
  test: {
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
