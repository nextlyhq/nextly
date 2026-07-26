import { defineConfig } from "tsup";

export default defineConfig({
  // Single Node-safe entry: the plugin adds fields + a permission (and, in
  // later Tier-0 PRs, an agnostic sitemap route). No `next`/`react` coupling —
  // the Next-only metadata/routing bridges ship from `nextly/runtime`, not here.
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
});
