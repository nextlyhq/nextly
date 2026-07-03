import { defineConfig } from "vitest/config";

// React JSX in tests uses the automatic runtime; renderToStaticMarkup runs in node.
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: { environment: "node" },
});
