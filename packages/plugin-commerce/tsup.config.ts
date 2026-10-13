import { defineConfig } from "tsup";

export default defineConfig({
  // Two Node-safe entries. The root carries money and the provider contracts;
  // `testing` carries the contract suites and the reference implementations
  // they are proved against, so a provider plugin's tests import them without
  // a site ever loading test code from the root.
  entry: ["src/index.ts", "src/testing/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
});
