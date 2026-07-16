import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    name: "admin",
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    // scripts/ too: the CSS scoper decides whether the admin's styles stay off
    // the host page, and it shipped a broken keyframe for want of a test.
    include: ["src/**/*.test.tsx", "src/**/*.test.ts", "scripts/**/*.test.mjs"],
    exclude: ["node_modules", "dist", ".turbo", "**/*.d.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/index.{ts,tsx}",
        "**/types.ts",
        "src/pages/**", // Exclude page files for now
      ],
      thresholds: {
        lines: 40,
        functions: 40,
        branches: 40,
        statements: 40,
      },
    },
    testTimeout: 10000,
  },
});
