import { defineConfig } from "vitest/config";

// Vitest config for playground-internal tooling and theme exploration.
// Discovers unit tests under scripts/__tests__/ for dev-experience helpers
// (doctor, seed, reset) and src/theme-lab/__tests__/ for theme-definition
// validators.
//
// Default environment stays "node": some fixtures here assert that a
// module throws when it detects a browser-like global (`window`), which a
// blanket jsdom environment would defeat. use-theme-lab's tests need
// localStorage and `document.querySelector`, which plain node doesn't
// provide -- that one file opts into jsdom itself via a
// `// @vitest-environment jsdom` docblock instead of changing the default
// for every other suite.
export default defineConfig({
  // The component tests render JSX, which the automatic runtime compiles to
  // `jsx()` imports rather than `React.createElement` -- without this esbuild
  // emits the classic runtime and every render throws "React is not defined".
  esbuild: { jsx: "automatic" },
  test: {
    globals: false,
    environment: "node",
    include: [
      "scripts/__tests__/**/*.test.ts",
      // .tsx too: component tests (the preview card) render JSX; each one
      // still opts into jsdom itself via a docblock, per the note above.
      "src/theme-lab/__tests__/**/*.test.{ts,tsx}",
    ],
  },
});
