import path from "path";

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "@nextly/storage": path.resolve(__dirname, "./src/storage/index.ts"),
    },
  },
  test: {
    name: "nextly",
    globals: true,
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    exclude: ["node_modules", "dist", ".turbo", "**/*.d.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/types/**",
        "**/index.ts",
        "scripts/**",
        "src/types/**",
        "src/database/schema/**",
        "src/schemas/**",
      ],
      thresholds: {
        // Target: 70% when DATABASE_URL is available for integration tests
        // Current: 50% threshold accounts for 610 pre-existing integration test
        // failures that require a running database (DATABASE_URL not set)
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
