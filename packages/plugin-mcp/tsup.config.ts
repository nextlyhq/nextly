import { defineConfig } from "tsup";

export default defineConfig({
  // Single Node-safe entry. The protocol surface is a request handler, so
  // nothing here couples to `next` or `react`: a headless deployment exposes
  // the same tools as one running the admin panel.
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
});
