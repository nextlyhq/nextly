import { defineConfig } from "tsup";

export default defineConfig({
  // Two Node-safe entries. The root carries the plugin, its settings and its
  // schema; `testing` carries the stand-ins for core's account capabilities,
  // so a site's tests can use them without ever loading test code from the
  // root.
  entry: ["src/index.ts", "src/testing/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
});
