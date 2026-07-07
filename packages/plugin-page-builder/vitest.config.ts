import { defineConfig } from "vitest/config";

// React JSX in tests uses the automatic runtime; renderToStaticMarkup runs in node.
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    environment: "node",
    // Unit tests live in src/. The Playwright e2e/ suite runs separately (needs a live
    // playground + browser) and must not be collected by vitest.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
