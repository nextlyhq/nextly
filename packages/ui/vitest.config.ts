import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The suites read `theme.css` and the package sources through the
    // filesystem rather than importing them, so Vitest has no module
    // dependency to invalidate and a watch session would keep reporting on
    // files it never re-read.
    forceRerunTriggers: [
      "**/package.json/**",
      "**/vitest.config.*/**",
      "**/vite.config.*/**",
      "**/src/**/*.{ts,tsx}",
      "**/src/**/*.css",
    ],
  },
});
