import { defineConfig } from "tsdown";

import { metafile } from "../../scripts/tsdown-metafile.mjs";

// The engine is runtime-free by contract: it ships no dependencies and must
// stay importable from Node scripts, edge runtimes, and the browser alike, so
// it bundles nothing and targets plain ESM.
export default defineConfig({
  entry: ["src/index.ts", "src/format.ts"],
  format: ["esm"],
  // Declarations without a type check: `check-types` is the type check.
  // oxc writes the declarations from the source's own annotations
  // (`isolatedDeclarations` in tsconfig.json). Named rather than left to the
  // plugin's choice, which picks `tsc` (or `tsgo` under TypeScript 7) without
  // saying so when the flag is off.
  dts: { generator: "oxc", sourcemap: false },
  clean: true,
  sourcemap: true,
  treeshake: true,
  // The module graph the bundler actually built, written beside the bundles.
  //
  // `format-boundary.test.ts` reads it because a graph OBSERVED by importing an
  // entry point only contains what initialisation resolved: a dynamic import
  // behind a function is a real edge to a real dependency that nothing asks the
  // resolver for until it is called. The metafile records every edge with its
  // kind, deferred ones included, from the tool that emitted the code.
  //
  // Kept out of the published package by the `files` negation in package.json:
  // it describes a build rather than shipping with one.
  plugins: [metafile()],
  // Keep the file names the exports map already publishes.
  outExtensions() {
    return { js: ".mjs", dts: ".d.ts" };
  },
});
