import { defineConfig } from "vitest/config";

// Vitest config for playground-internal tooling and theme exploration.
// Discovers unit tests under scripts/__tests__/ for dev-experience helpers
// (doctor, seed, reset) and src/theme-lab/__tests__/ for theme-definition
// validators.
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: [
      "scripts/__tests__/**/*.test.ts",
      "src/theme-lab/__tests__/**/*.test.ts",
    ],
  },
});
