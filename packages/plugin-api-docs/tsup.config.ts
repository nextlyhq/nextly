import { defineConfig } from "tsup";

export default defineConfig({
  // Single Node-safe entry: the plugin contributes routes + a sidebar entry.
  // No `next` or `react` coupling — the docs page is plain HTML served as a
  // Response, so the plugin stays framework-agnostic like the other first-party
  // plugins.
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
  // The vendored Scalar bundle imports as a string. A text import is inert to
  // the host app's bundler, where a runtime require.resolve of the package
  // would be statically analyzed and fail.
  loader: {
    ".txt": "text",
  },
});
