import { defineConfig } from "vitest/config";

// Unit suites only: nothing in this package boots a Nextly instance yet, so it
// has no integration lane to keep apart.
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
