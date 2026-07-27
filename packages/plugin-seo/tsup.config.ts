import { defineConfig } from "tsup";

export default defineConfig({
  // Single Node-safe entry: the plugin adds an SEO field group. No `next` or
  // `react` coupling, so it stays usable in headless and admin-only projects.
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
});
