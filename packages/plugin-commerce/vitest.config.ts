import { defineConfig } from "vitest/config";

// Unit suites only: the suites that boot a Nextly instance against a database
// are *.integration.test.ts, run by vitest.integration.config.ts.
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/**/*.integration.test.ts",
    ],
  },
});
