import { defineConfig } from "tsdown";

export default defineConfig({
  // Single Node-safe entry. The protocol surface is a request handler, so
  // nothing here couples to `next` or `react`: a headless deployment exposes
  // the same tools as one running the admin panel.
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
