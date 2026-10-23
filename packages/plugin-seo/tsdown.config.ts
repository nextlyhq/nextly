import { defineConfig } from "tsdown";

export default defineConfig({
  // Single Node-safe entry: the plugin adds an SEO field group. No `next` or
  // `react` coupling, so it stays usable in headless and admin-only projects.
  entry: ["src/index.ts"],
  format: ["esm"],
  // `.js` and `.d.ts`, the names the exports map already publishes.
  fixedExtension: false,
  // Declarations without a type check: `check-types` is the type check.
  dts: { sourcemap: false, compilerOptions: { noCheck: true } },
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
});
