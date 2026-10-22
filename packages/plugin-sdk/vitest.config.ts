import { defineConfig } from "vitest/config";

// Unit suites only; the integration lane, which boots Nextly, has its own
// config.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
  },
});
