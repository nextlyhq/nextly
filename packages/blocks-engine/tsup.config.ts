import { defineConfig } from "tsup";

// The engine is runtime-free by contract: it ships no dependencies and must
// stay importable from Node scripts, edge runtimes, and the browser alike, so
// it bundles nothing and targets plain ESM.
export default defineConfig({
  entry: ["src/index.ts", "src/format.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // The module graph esbuild actually built, written beside the bundles.
  //
  // `format-boundary.test.ts` reads it because a graph OBSERVED by importing an
  // entry point only contains what initialisation resolved: a dynamic import
  // behind a function is a real edge to a real dependency that nothing asks the
  // resolver for until it is called. The metafile records every edge with its
  // kind, deferred ones included, from the tool that emitted the code.
  //
  // Kept out of the published package by the `files` negation in package.json:
  // it describes a build rather than shipping with one.
  metafile: true,
  outExtension() {
    return { js: ".mjs" };
  },
});
