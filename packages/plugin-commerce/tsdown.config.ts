import { defineConfig } from "tsdown";

export default defineConfig({
  // Two Node-safe entries. The root carries money and the provider contracts;
  // `testing` carries the contract suites and the reference implementations
  // they are proved against, so a provider plugin's tests import them without
  // a site ever loading test code from the root.
  entry: ["src/index.ts", "src/testing/index.ts"],
  format: ["esm"],
  // `.js` and `.d.ts`, the names the exports map already publishes.
  fixedExtension: false,
  // Declarations without a type check: `check-types` is the type check.
  // oxc writes the declarations from the source's own annotations
  // (`isolatedDeclarations` in tsconfig.json). Named rather than left to the
  // plugin's choice, which picks `tsc` (or `tsgo` under TypeScript 7) without
  // saying so when the flag is off.
  dts: { generator: "oxc", sourcemap: false },
  clean: true,
  sourcemap: true,
  minify: false,
  target: "es2022",
});
