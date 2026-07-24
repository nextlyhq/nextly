import { defineConfig } from "tsup";

// The engine is runtime-free by contract: it ships no dependencies and must
// stay importable from Node scripts, edge runtimes, and the browser alike, so
// it bundles nothing and targets plain ESM.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  outExtension() {
    return { js: ".mjs" };
  },
});
